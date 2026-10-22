import { act, render, screen } from '@testing-library/react-native';
import { AccessibilityInfo, Animated } from 'react-native';
import { SetupProgressBar } from './SetupProgressBar';

afterEach(()=>jest.restoreAllMocks());
it('exposes only measured download progress to accessibility services', async()=>{
  await render(<SetupProgressBar label="Kali download" fraction={.42} running/>);
  expect(screen.getByRole('progressbar',{name:'Kali download'})).toHaveProp('accessibilityValue',{min:0,max:100,now:42});
});
it('keeps indeterminate work static when reduced motion is requested', async()=>{
  jest.spyOn(AccessibilityInfo,'isReduceMotionEnabled').mockResolvedValue(true);
  const animation=jest.spyOn(Animated,'loop');
  await render(<SetupProgressBar label="Unpacking Kali" running/>);
  expect(animation).not.toHaveBeenCalled();
  expect(screen.getByRole('progressbar')).toHaveProp('accessibilityValue',{text:'Working; percentage unavailable'});
});
it('stops the moving marker when reduced motion changes while the task is running', async()=>{
  jest.spyOn(AccessibilityInfo,'isReduceMotionEnabled').mockResolvedValue(false);
  let change: ((value:boolean)=>void) | undefined;
  const remove=jest.fn();
  jest.spyOn(AccessibilityInfo,'addEventListener').mockImplementation(((_event:string,listener:(value:boolean)=>void)=>{change=listener; return {remove};}) as unknown as typeof AccessibilityInfo.addEventListener);
  const start=jest.fn(),stop=jest.fn();
  jest.spyOn(Animated,'loop').mockReturnValue({start,stop,reset:jest.fn()});
  const view=await render(<SetupProgressBar label="Unpacking Kali" running/>);
  expect(start).toHaveBeenCalledTimes(1);
  await act(async()=>{change?.(true);});
  expect(stop).toHaveBeenCalledTimes(1);
  await view.unmount();expect(remove).toHaveBeenCalledTimes(1);
});
it('uses the static default when the accessibility setting is unavailable', async()=>{
  jest.spyOn(AccessibilityInfo,'isReduceMotionEnabled').mockRejectedValue(new Error('unavailable'));
  const animation=jest.spyOn(Animated,'loop');
  await render(<SetupProgressBar label="Checking tools" running/>);
  expect(animation).not.toHaveBeenCalled();
});
it('does not let a late preference read override a newer reduce-motion event', async () => {
  let finish!: (value:boolean) => void;
  let change!: (value:boolean) => void;
  jest.spyOn(AccessibilityInfo,'isReduceMotionEnabled').mockImplementation(() => new Promise(resolve => {finish=resolve;}));
  jest.spyOn(AccessibilityInfo,'addEventListener').mockImplementation(((_event:string,listener:(value:boolean)=>void) => {change=listener;return {remove:jest.fn()};}) as unknown as typeof AccessibilityInfo.addEventListener);
  const animation=jest.spyOn(Animated,'loop');
  await render(<SetupProgressBar label="Checking tools" running />);
  await act(async () => { change(true); finish(false); });
  expect(animation).not.toHaveBeenCalled();
});
