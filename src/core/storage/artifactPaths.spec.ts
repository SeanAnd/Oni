import { artifactFileUri, projectRootUri } from './artifactPaths';
it.each(['../escape', 'a/b', '.', '..', '%2fsecret', 'name\n'])('rejects traversal in project or artifact names: %s', (value) => {
  expect(() => projectRootUri('file:///documents/', value)).toThrow();
  expect(() => artifactFileUri('file:///documents/', 'project', 'jobs', value)).toThrow();
});
it('keeps artifact paths beneath their project directory', () => {
  expect(artifactFileUri('file:///documents', 'project', 'jobs', 'artifact.xml')).toBe('file:///documents/projects/project/jobs/artifact.xml');
});
