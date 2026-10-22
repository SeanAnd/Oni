import { runAppStateMigrations } from '@/core/storage/migrationRunner';
import { ProjectRepository } from '@/core/storage/projectRepository';
import { ObservationRepository } from '@/core/storage/observationRepository';
import { createNodeSqlDatabase } from '@/core/storage/sqlDatabase.node';

describe('project repository scoping', () => {
  it('scopes ownership and observations by project id', async () => {
    const db = createNodeSqlDatabase(':memory:');
    runAppStateMigrations(db);
    const projects = new ProjectRepository(db);
    const observations = new ObservationRepository(db);

    const alpha = projects.createProject({ name: 'Alpha', description: '' });
    const beta = projects.createProject({ name: 'Beta', description: '' });

    observations.insertMany(alpha.id, 'job-a', [
      { type: 'network.host', source: 'test', data: { address: '10.0.0.1' } },
    ]);
    observations.insertMany(beta.id, 'job-b', [
      { type: 'network.host', source: 'test', data: { address: '10.0.0.2' } },
    ]);

    await expect(projects.ownsProject(alpha.id)).resolves.toBe(true);
    await expect(projects.ownsProject('missing')).resolves.toBe(false);
    expect(observations.listHosts(alpha.id)).toHaveLength(1);
    expect(observations.listHosts(beta.id)).toHaveLength(1);
    expect(observations.listHosts(alpha.id)[0]?.address).toBe('10.0.0.1');
  });
});
