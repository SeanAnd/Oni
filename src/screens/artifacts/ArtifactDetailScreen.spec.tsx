import { ArtifactRepository } from '@/core/storage/artifactRepository';
import { openAppStateDatabase } from '@/core/storage/appStateDatabase';
import { render, screen } from '@testing-library/react-native';
import { ArtifactDetailScreen } from './ArtifactDetailScreen';
import { ProjectService } from '@/core/projects/projectService';
import { installTestAppStateDatabase, resetTestAppStateDatabase } from '@/testing/appStateTestHarness';
let mockParams = {projectId: '', artifactId: 'artifact'};
jest.mock('expo-router', () => ({
 useRouter: () => ({push: jest.fn()}), useLocalSearchParams: () => mockParams,
 useFocusEffect: (callback: () => void | (() => void)) => jest.requireActual<typeof import('react')>('react').useEffect(callback, [callback]),
}));
beforeEach(() => { installTestAppStateDatabase(); });
afterEach(resetTestAppStateDatabase);
it('does not display an artifact from a different project', async () => {
 const service = new ProjectService();
 const first = await service.createProject({ name: 'First lab', description: '' });
 const second = await service.createProject({ name: 'Second lab', description: '' });
 new ArtifactRepository(openAppStateDatabase()).register({id: 'artifact', projectId: first.project!.id, type: 'nmap.xml', mimeType: 'application/xml', path: 'private.xml', size: 20, hash: 'a'.repeat(64), source: 'nmap'});
 // The lookup uses the project detail boundary, not an unscoped artifact ID.
 mockParams = {projectId: second.project!.id, artifactId: 'artifact'};
 await render(<ArtifactDetailScreen />);
 expect(await screen.findByText('Artifact not found in this project.')).toBeOnTheScreen();
 expect(screen.queryByText('Recorded SHA-256')).toBeNull();
});
