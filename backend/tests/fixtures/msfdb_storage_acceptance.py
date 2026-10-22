"""Synthetic certificate and non-authenticating Kerberos cache storage parity."""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path.home() / '.rootless-workstation/bin'))
import workstation_common as common

RESOURCE = r'''<ruby>
require 'json'
require 'openssl'
require 'base64'
require 'digest'
begin
  name='oni_storage_'+Process.pid.to_s
  framework.db.workspace=framework.db.add_workspace(name)
  root=Msf::Config.config_directory
  key=OpenSSL::PKey::RSA.new(2048)
  cert=OpenSSL::X509::Certificate.new
  cert.version=2;cert.serial=1
  cert.subject=cert.issuer=OpenSSL::X509::Name.parse('/CN=Oni synthetic storage fixture')
  cert.public_key=key.public_key;cert.not_before=Time.now-60;cert.not_after=Time.now+3600
  cert.sign(key,OpenSSL::Digest.new('SHA256'))
  pfx=OpenSSL::PKCS12.create('','oni_fixture',key,cert)
  credential=framework.db.create_credential(workspace_id:framework.db.workspace.id,username:'oni_fixture',private_type: :pkcs12,private_data:Base64.strict_encode64(pfx.to_der),origin_type: :import,filename:'oni synthetic fixture')
  certificates=Msf::Exploit::Remote::Pkcs12::Storage.new(framework:framework)
  raise 'certificate' unless certificates.pkcs12(workspace:name).count==1
  run_single('certs -i '+credential.id.to_s+' -A')
  raise 'certinactive' unless certificates.pkcs12(workspace:name).first.status=='inactive'
  run_single('certs -i '+credential.id.to_s+' -a')
  export=File.join(root,'export.pfx')
  run_single('certs -i '+credential.id.to_s+' -e '+export)
  raise 'certexport' unless Digest::SHA256.file(export).hexdigest==Digest::SHA256.hexdigest(pfx.to_der)
  principal={name_type:1,realm:'ONI.TEST',components:['oni_fixture']}
  ccache=Rex::Proto::Kerberos::CredentialCache::Krb5Ccache.new(default_principal:principal,credentials:[{
    client:principal,server:{name_type:2,realm:'ONI.TEST',components:['krbtgt','ONI.TEST']},
    keyblock:{enctype:18,data:'0'*32},authtime:Time.now,starttime:Time.now,endtime:Time.now+3600,renew_till:Time.now+7200,
    ticket_flags:0,ticket:'Oni synthetic opaque ticket: unusable for authentication'
  }])
  tickets=Msf::Exploit::Remote::Kerberos::Ticket::Storage::ReadWrite.new(framework:framework)
  ticket=tickets.store_ccache(ccache,host:'127.0.0.1')
  stored=tickets.tickets(workspace:framework.db.workspace).first
  raise 'cache' unless stored && stored.ccache.encode==ccache.encode
  run_single('klist -i '+stored.id.to_s+' -A')
  raise 'ticketinactive' unless tickets.tickets(workspace:framework.db.workspace).first.status=='inactive'
  run_single('klist -i '+stored.id.to_s+' -a')
  File.write(File.join(root,'fixture.json'),{workspace:name,cert:credential.id,ticket:stored.id,path:ticket[:path],sha256:Digest::SHA256.hexdigest(ccache.encode)}.to_json)
  puts 'ONI_STORAGE:'+{ok:true,seeded:true}.to_json
rescue StandardError => e
  puts 'ONI_STORAGE:'+{ok:false,category:e.class.name,method:(e.respond_to?(:name) ? e.name : nil),stage:(e.message =~ /A[a-z]+z/ ? e.message : 'api')}.to_json
end
</ruby>
exit -y
'''

VERIFY = r'''<ruby>
require 'json'
require 'digest'
begin
  fixture=JSON.parse(File.read(File.join(Msf::Config.config_directory,'fixture.json')))
  framework.db.workspace=framework.db.find_workspace(fixture['workspace'])
  certificates=Msf::Exploit::Remote::Pkcs12::Storage.new(framework:framework)
  raise 'certpersistence' unless certificates.pkcs12(workspace:fixture['workspace']).first.id==fixture['cert']
  tickets=Msf::Exploit::Remote::Kerberos::Ticket::Storage::ReadWrite.new(framework:framework)
  stored=tickets.tickets(workspace:framework.db.workspace).first
  raise 'ticketpersistence' unless stored.id==fixture['ticket'] && Digest::SHA256.hexdigest(stored.ccache.encode)==fixture['sha256']
  raise 'filepersistence' unless Digest::SHA256.file(fixture['path']).hexdigest==fixture['sha256']
  run_single('certs -i '+fixture['cert'].to_s+' -d')
  run_single('klist -i '+fixture['ticket'].to_s+' -d')
  raise 'delete' unless certificates.pkcs12(workspace:fixture['workspace']).empty? && tickets.tickets(workspace:framework.db.workspace).empty?
  workspace=framework.db.workspace
  framework.db.workspace=framework.db.default_workspace
  framework.db.delete_workspaces(ids:[workspace.id])
  puts 'ONI_STORAGE:'+{ok:true,certificateCRUD:true,certificateExport:true,kerberosCacheCRUD:true,consoleRestartPersistence:true,lootBytes:true}.to_json
rescue StandardError => e
  puts 'ONI_STORAGE:'+{ok:false,category:e.class.name,method:(e.respond_to?(:name) ? e.name : nil),stage:(e.message =~ /A[a-z]+z/ ? e.message : 'api')}.to_json
end
</ruby>
exit -y
'''

PROGRAM = r'''
import json,os,pathlib,shutil,subprocess,sys,tempfile
resources=json.load(sys.stdin)
root=pathlib.Path(tempfile.mkdtemp(prefix='oni-storage-'))
shutil.copyfile(pathlib.Path.home()/'.msf4/database.yml',root/'database.yml');(root/'database.yml').chmod(0o600)
environment={**os.environ,'MSF_CFGROOT_CONFIG':str(root)}
success=False
try:
 for source in resources:
  r=subprocess.run(['msfconsole','-q','-r','/dev/stdin'],input=source,text=True,capture_output=True,env=environment,timeout=120)
  marker=next((line.split(':',1)[1] for line in r.stdout.splitlines() if line.startswith('ONI_STORAGE:')),None)
  result=json.loads(marker) if marker else {'ok':False,'stage':'no_marker'}
  if r.returncode or not result['ok']:break
 else:success=True
 if not success:result['retainedConfig']=root.name
 print(json.dumps(result))
finally:
 if success:shutil.rmtree(root)
'''

result = common.run_kali('python3', ['-c', PROGRAM], input=json.dumps([RESOURCE, VERIFY]), timeout=260)
print(result.stdout.strip() or json.dumps({'ok': False, 'stage': 'transport'}))
if result.returncode or not json.loads(result.stdout).get('ok'):
    raise SystemExit(1)
