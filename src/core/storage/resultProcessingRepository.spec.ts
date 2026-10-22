import { createNodeSqlDatabase } from './sqlDatabase.node';
import { runAppStateMigrations } from './migrationRunner';
import { ProjectRepository } from './projectRepository';
import { ResultProcessingRepository } from './resultProcessingRepository';

it('retains failure, raw artifact identity and attempts across repository restart', () => {
  const db = createNodeSqlDatabase(':memory:');
  runAppStateMigrations(db);
  const project = new ProjectRepository(db).createProject({name: 'Processing', description: '', notes: ''});
  const repository = new ResultProcessingRepository(db);
  repository.begin(project.id, 'job');
  repository.finish(project.id, 'job', {ok: false, errorKey: 'PARSER_FAILED', artifactId: 'artifact', artifactHash: 'a'.repeat(64)});
  const reopened = new ResultProcessingRepository(db);
  expect(reopened.get(project.id, 'job')).toMatchObject({state: 'failed', attemptCount: 1, errorKey: 'PARSER_FAILED', artifactHash: 'a'.repeat(64)});
  reopened.begin(project.id, 'job');
  reopened.finish(project.id, 'job', {ok: true, artifactId: 'artifact', artifactHash: 'a'.repeat(64)});
  expect(reopened.get(project.id, 'job')).toMatchObject({state: 'succeeded', attemptCount: 2});
  db.close();
});
