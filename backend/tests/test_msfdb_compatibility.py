"""Compatibility policy, reversible configuration, and authorization regressions."""
import importlib.util
from importlib.machinery import SourceFileLoader
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import workstation_common as common
import workstation_jobs as jobs
import workstation_msf_config as config
import workstation_msfdb as cli
from workstation_database import DatabaseError, ManagedDatabase
from workstation_msfdb_maintenance import maintenance, rollback_deleted


class ConfigurationTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.home = Path(self.temp.name)
        self.request = dict(profileId='termux-local', config=dict(adapter='postgresql', host='127.0.0.1', port=5432, username='msf', database='msf', password='private-password'), wrapper='#!/usr/bin/env python3\nprint("wrapper")\n', token='t'*64)

    def test_default_and_profile_match_and_reinstall_is_idempotent(self):
        config.publish(self.request, self.home)
        first = {str(p.relative_to(self.home)):p.read_bytes() for p in self.home.rglob('*') if p.is_file()}
        config.publish(self.request, self.home)
        second = {str(p.relative_to(self.home)):p.read_bytes() for p in self.home.rglob('*') if p.is_file()}
        self.assertEqual(first, second)
        self.assertEqual((self.home/'.msf4/database.yml').read_bytes(), (self.home/'.msf4/skid-termux-local.json').read_bytes())
        self.assertEqual((self.home/'.msf4/database.yml').stat().st_mode & 0o777, 0o600)
        self.assertEqual((self.home/'.bashrc').read_text().count('# >>> Oni'), 1)

    def test_original_config_and_unrelated_saved_services_are_preserved(self):
        directory=self.home/'.msf4'; directory.mkdir()
        original=b'original database configuration\n'
        (directory/'database.yml').write_bytes(original)
        saved=b'[framework/database]\ndefault_db=old-host\n[framework/database/old-host]\nurl=private-old-connection\n[framework/core]\nPrompt=keep\n'
        (directory/'config').write_bytes(saved)
        config.publish(self.request,self.home)
        self.assertEqual((directory/'config').read_bytes(),saved.replace(b'default_db=old-host\n',b''))
        backups=[p.read_bytes() for p in (directory/'oni-managed').glob('*.original')]
        self.assertIn(original,backups); self.assertIn(saved,backups)

    def test_framework_saved_managed_connection_is_preserved(self):
        directory=self.home/'.msf4';directory.mkdir()
        saved=b'[framework/database]\ndefault_db=local\n[framework/database/local]\nurl=msf:private-password@127.0.0.1:5432/msf\n'
        (directory/'config').write_bytes(saved)
        config.publish(self.request,self.home)
        self.assertEqual((directory/'config').read_bytes(),saved)
        self.assertTrue(config.default_matches(saved,self.request['config']))
        self.assertFalse(config.default_matches(saved.replace(b'5432',b'6543'),self.request['config']))

    def test_managed_launch_rejects_alternate_environment_root_or_database(self):
        config.publish(self.request, self.home)
        self.assertEqual(config.validate_launch(self.home, {}), self.home/'.msf4/skid-termux-local.json')
        for variable in ['MSF_CFGROOT_CONFIG', 'MSF_DATABASE_CONFIG']:
            with self.subTest(variable=variable), self.assertRaises(ValueError):
                config.validate_launch(self.home, {variable: '/tmp/another-framework-config'})

    def test_staging_launch_uses_private_configuration_and_cleans_up_on_failure(self):
        config.publish(self.request, self.home)
        binary=self.home/'msfconsole'
        binary.write_text('#!'+sys.executable+'\nimport json,os,pathlib,sys\np=pathlib.Path(sys.argv[sys.argv.index("-y")+1]);cfg=json.loads(p.read_text());print(json.dumps({"database":cfg["production"]["database"],"mode":p.stat().st_mode&0o777,"savedDefault":(pathlib.Path(os.environ["MSF_CFGROOT_CONFIG"])/"config").exists()}));sys.exit(7)\n')
        binary.chmod(0o700)
        staging='skid_stage_'+'a'*16
        result=subprocess.run([sys.executable,'-c',common.msf_exec_program('termux-local',staging)],env={**os.environ,'HOME':str(self.home),'PATH':str(self.home)+os.pathsep+os.environ['PATH']},capture_output=True,text=True)
        self.assertEqual(result.returncode,7,result.stderr)
        self.assertEqual(json.loads(result.stdout),dict(database=staging,mode=0o600,savedDefault=False))
        self.assertEqual(list((self.home/'.msf4/oni-managed').glob('staging-probe-*')),[])

    def test_edited_managed_profile_fails_before_overwriting_default(self):
        config.publish(self.request,self.home)
        profile=self.home/'.msf4/skid-termux-local.json'
        profile.write_text('user edit')
        before=(self.home/'.msf4/database.yml').read_bytes()
        with self.assertRaises(ValueError): config.publish(self.request,self.home)
        self.assertEqual(profile.read_text(),'user edit')
        self.assertEqual((self.home/'.msf4/database.yml').read_bytes(),before)

    def test_interrupted_config_publication_resumes(self):
        original=config.atomic
        def fail(path,data,mode=0o600):
            if path.name=='database.yml': raise OSError('interrupted')
            return original(path,data,mode)
        with patch.object(config,'atomic',side_effect=fail),self.assertRaises(OSError): config.publish(self.request,self.home)
        config.publish(self.request,self.home)
        self.assertEqual((self.home/'.msf4/database.yml').read_bytes(),(self.home/'.msf4/skid-termux-local.json').read_bytes())

    def test_symlink_destination_does_not_write_outside_home(self):
        directory=self.home/'.msf4';directory.mkdir()
        outside=self.home/'outside';outside.write_text('preserved')
        (directory/'database.yml').symlink_to(outside)
        with self.assertRaises(ValueError): config.publish(self.request,self.home)
        self.assertEqual(outside.read_text(),'preserved')

    def test_uninstall_restores_original_and_reinstall_works(self):
        directory=self.home/'.msf4';directory.mkdir()
        (directory/'database.yml').write_text('original')
        config.publish(self.request,self.home)
        self.assertTrue(config.uninstall(self.home)['ok'])
        self.assertEqual((directory/'database.yml').read_text(),'original')
        self.assertFalse((self.home/'.local/share/oni/bin/msfdb').exists())
        config.publish(self.request,self.home)
        self.assertTrue((self.home/'.local/share/oni/bin/msfdb').exists())

    def test_uninstall_preserves_user_edit(self):
        config.publish(self.request,self.home)
        target=self.home/'.msf4/database.yml';target.write_text('user edit')
        result=config.uninstall(self.home)
        self.assertIn('.msf4/database.yml',result['conflicts'])
        self.assertEqual(target.read_text(),'user edit')

    def test_installed_shell_resolves_wrapper_and_preserves_user_startup(self):
        (self.home/'.bashrc').write_text('export USER_SETTING=retained\n')
        config.publish(self.request,self.home)
        result=subprocess.run(['bash','--noprofile','--rcfile',str(self.home/'.bashrc'),'-ic','command -v msfdb; printf "%s" "$USER_SETTING"'],env={**os.environ,'HOME':str(self.home)},capture_output=True,text=True)
        self.assertIn(str(self.home/'.local/share/oni/bin/msfdb'),result.stdout)
        self.assertTrue(result.stdout.endswith('retained'))


class PolicyTests(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory()
        self.previous=common.WORKSTATION_HOME
        common.rebind_workstation_home(Path(self.temp.name))
        common.ensure_layout()
        self.addCleanup(self.temp.cleanup)
        self.addCleanup(common.rebind_workstation_home,self.previous)

    def test_unknown_fields_paths_and_destructive_unconfirmed_requests_fail(self):
        for payload in [dict(verb='exec',operationId='x'),dict(verb='status',operationId='../x'),dict(verb='start',operationId='x',host='remote'),dict(verb='delete',operationId='x'),dict(verb='reinit',operationId='x',confirmationId='../../bad'),dict(verb='rollback',operationId='x')]:
            with self.subTest(payload=payload),self.assertRaises(DatabaseError): cli.parse(payload)

    def test_scoped_credential_does_not_authorize_general_helper(self):
        import workstation_helper as helper
        (common.STATE_DIR/'msfdb-token').write_text('cli-token')
        (common.STATE_DIR/'helper_token').write_text('app-token')
        self.assertTrue(cli.authorize('cli-token'))
        self.assertFalse(cli.authorize('app-token'))
        self.assertFalse(helper.authorize('Bearer cli-token'))
        self.assertTrue(helper.authorize('Bearer app-token'))
        (common.STATE_DIR/'msfdb-token').write_text('rotated')
        self.assertFalse(cli.authorize('cli-token'))

    def test_job_policy_rejects_secrets_and_commands(self):
        value=dict(jobId='job',projectId='system-onboarding',operationId='op',timeoutMs=180000,task=dict(type='msfdb',verb='start',operationId='op'))
        self.assertIsNotNone(jobs.parse_request(json.dumps(value))[0])
        for field in ['password','command','host','token']:
            with self.subTest(field=field):
                self.assertIsNone(jobs.parse_request(json.dumps({**value,'task':{**value['task'],field:'forbidden'}}))[0])

    def test_completed_request_replays_and_changed_payload_cannot_reuse_identity(self):
        payload=dict(verb='start',operationId='op')
        state=dict(jobId=cli.job_id('op'),operationId='op',status='completed',request={'task':{'type':'msfdb',**payload}})
        with patch.object(jobs,'load_job',return_value=state),patch.object(cli.subprocess,'Popen') as start:
            self.assertEqual(cli.dispatch(payload)['status'],'completed')
            with self.assertRaises(DatabaseError): cli.dispatch(dict(verb='stop',operationId='op'))
        start.assert_not_called()

    def test_explicit_retry_keeps_logical_identity_and_creates_distinct_attempt(self):
        payload=dict(verb='start',operationId='op')
        state=dict(jobId=cli.job_id('op'),operationId='op',status='failed',request={'task':{'type':'msfdb',**payload}})
        with patch.object(jobs,'load_job',side_effect=[state,{'status':'running'}]),patch.object(cli.subprocess,'Popen') as start:
            self.assertEqual(cli.dispatch({**payload,'retry':True})['status'],'running')
        request=json.loads(start.call_args.args[0][-1])
        self.assertNotEqual(request['operationId'],'op')
        self.assertEqual(request['task']['operationId'],'op')
        self.assertNotEqual(request['jobId'],state['jobId'])

    def test_status_does_not_start_or_launch_framework(self):
        with patch.object(ManagedDatabase,'health',return_value={'ok':False,'authenticatedQueryOk':False,'schemaReady':False}), patch.object(ManagedDatabase,'start') as start,patch.object(cli,'verify') as verify:
            result=cli.perform(dict(verb='status',operationId='op'))
        start.assert_not_called();verify.assert_not_called()
        self.assertFalse(result['ok'])
        self.assertFalse(result['running'])
        self.assertNotIn('schemaReady', result)

    def test_restart_serializes_stop_then_start(self):
        calls=[]
        with patch.object(ManagedDatabase,'perform',side_effect=lambda request:calls.append(request['operation'])),patch.object(ManagedDatabase,'start',side_effect=lambda:calls.append('start') or {'running':True}):
            self.assertTrue(cli.perform(dict(verb='restart',operationId='op'))['running'])
        self.assertEqual(calls,['stop','start'])

    def test_first_init_requires_paired_credential(self):
        with self.assertRaises(DatabaseError) as error: cli.perform(dict(verb='init',operationId='op'))
        self.assertEqual(error.exception.key,'DATABASE_CREDENTIALS_INVALID')

    def test_running_database_does_not_skip_init_configuration_and_schema(self):
        db=ManagedDatabase();db.layout();(db.root/'msf.secret').write_text('x'*64)
        with patch.object(ManagedDatabase,'initialize') as init,patch.object(ManagedDatabase,'verify_identity'),patch.object(cli,'configure') as configure,patch.object(cli,'verify',return_value={'schemaReady':True}):
            self.assertTrue(cli.perform(dict(verb='init',operationId='op'))['schemaReady'])
        init.assert_called_once();configure.assert_called_once()

    def test_confirmation_must_exist_before_reset(self):
        db=ManagedDatabase();db.layout()
        with patch.object(db,'owner',return_value={'installationId':'owned'}),patch.object(db,'start'),self.assertRaises(DatabaseError) as error:
            maintenance(db,dict(verb='reinit',operationId='op',confirmationId='a'*32))
        self.assertEqual(error.exception.key,'PERMISSION_DENIED')

    def test_expired_confirmation_does_not_issue_sql(self):
        db=ManagedDatabase();db.layout();directory=db.root/'msfdb-maintenance';directory.mkdir()
        (directory/('a'*32+'.json')).write_text(json.dumps(dict(verb='reinit',installationId='owned',phase='prepared',expiresAt=0)))
        with patch.object(db,'owner',return_value={'installationId':'owned'}),patch.object(db,'start'),patch.object(db,'psql') as sql,self.assertRaises(DatabaseError):
            maintenance(db,dict(verb='reinit',operationId='op',confirmationId='a'*32))
        sql.assert_not_called()

    def test_foreign_active_session_blocks_backup_and_replacement(self):
        db=ManagedDatabase();db.layout()
        with patch.object(db,'owner'),patch.object(db,'start'),patch.object(db,'psql',return_value='1'),patch.object(db,'backup') as backup,self.assertRaises(DatabaseError) as error:
            maintenance(db,dict(verb='prepare-reinit',operationId='op'))
        self.assertEqual(error.exception.key,'DATABASE_BUSY');backup.assert_not_called()

    def test_interrupted_delete_rollback_rejects_another_database_oid(self):
        db=ManagedDatabase();db.layout()
        suffix='a'*16
        (db.root/(suffix+'.cutover.json')).write_text(json.dumps(dict(phase='rolling_back',maintenance='delete',retainedOid='41')))
        with patch.object(db,'psql',side_effect=['postgres\nmsf','42']),self.assertRaises(DatabaseError) as error:
            rollback_deleted(db,dict(rollbackId=suffix),'rolling_back')
        self.assertEqual(error.exception.key,'DATABASE_OWNERSHIP_DENIED')

    def test_old_success_marker_without_identity_is_rejected(self):
        verify=cli.load_entry('workstation-msf-verify')
        result=subprocess.CompletedProcess([],0,'SKID_DB_STATUS:{"connected":true,"schemaReady":true}','')
        ok,key,_=verify.interpret_db_status(result)
        self.assertFalse(ok);self.assertEqual(key,'DATABASE_OWNERSHIP_DENIED')

    def test_staging_probe_uses_staging_identity(self):
        verify=cli.load_entry('workstation-msf-verify')
        with patch.object(verify,'run_kali') as run:
            verify.run_db_status(staging='skid_stage_'+'a'*16)
        self.assertIn("cfg[:database] == 'skid_stage_"+'a'*16+"'",run.call_args.kwargs['input'])
        self.assertNotIn('framework.db.disconnect',run.call_args.kwargs['input'])
        self.assertIn('TemporaryDirectory',run.call_args.args[1][1])

    def test_cli_unconfirmed_delete_never_contacts_helper(self):
        module=cli.load_entry('workstation-msfdb-client')
        with patch.object(module,'request') as request,self.assertRaises(module.ClientError): module.main(['delete'])
        request.assert_not_called()

    def test_cli_run_preserves_console_argument_boundaries(self):
        module=cli.load_entry('workstation-msfdb-client')
        with patch.object(module,'wait',return_value={'ok':True}),patch.object(module,'launch_profile',return_value=Path('/private/profile')),patch.object(module.os,'execvp') as execute:
            module.main(['run','--','-r','file with spaces.rc'])
        self.assertEqual(execute.call_args.args[1][-2:],['-r','file with spaces.rc'])
