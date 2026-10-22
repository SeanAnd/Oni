import { useRef } from 'react';
import { View } from 'react-native';
import { render, screen, userEvent, fireEvent } from '@testing-library/react-native';
import { ModalProvider, useModalService } from './ModalProvider';
import { ActionButton } from '../ActionButton';
jest.mock('@/core/state/useSetupReadiness', () => ({useSetupReadinessLifecycle:jest.fn()}));
function Consumer({result}: {result: (value: string) => void}) {
  const ref=useRef<View>(null); const show=useModalService(ref);
  return <ActionButton buttonRef={ref} label="Ask" onPress={() => { void show({title:'Close session?',body:'Running work stops.',primaryLabel:'Confirm close',secondaryLabel:'Cancel',tone:'danger',dismissOnBackdrop:true}).then(result); }} />;
}
it.each(['back','backdrop','secondary'] as const)('settles %s without confirming a destructive action', async path => {
  const result=jest.fn();
  await render(<ModalProvider><Consumer result={result} /></ModalProvider>);
  await userEvent.press(screen.getByRole('button',{name:'Ask'}));
  expect(screen.getByRole('header',{name:'Close session?'})).toBeOnTheScreen();
  if (path === 'back') await fireEvent(screen.getByTestId('themed-modal'),'requestClose');
  else if (path === 'backdrop') await fireEvent.press(screen.getByTestId('modal-backdrop'));
  else await userEvent.press(screen.getByRole('button',{name:'Cancel'}));
  expect(result).toHaveBeenCalledWith(path === 'secondary' ? 'secondary' : 'dismissed');
  expect(screen.queryByText('Running work stops.')).toBeNull();
});
it('settles caller promises when the host unmounts', async () => {
  const result=jest.fn();
  const view=await render(<ModalProvider><Consumer result={result} /></ModalProvider>);
  await userEvent.press(screen.getByRole('button',{name:'Ask'}));
  await view.unmount();
  expect(result).toHaveBeenCalledWith('dismissed');
});
