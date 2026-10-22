import { render, screen, userEvent, act } from '@testing-library/react-native';
import { AccessibilityInfo, Animated, AppState } from 'react-native';
import { ThemedToggle } from './ThemedToggle';
afterEach(() => jest.restoreAllMocks());

it('stays controlled when a parent rejects a switch change', async () => {
  const change=jest.fn();
  await render(<ThemedToggle label="Detect services" value={false} onValueChange={change} />);
  await userEvent.press(screen.getByRole('switch',{name:'Detect services'}));
  expect(change).toHaveBeenCalledWith(true);
  expect(screen.getByRole('switch').props.accessibilityState.checked).toBe(false);
});
it('cannot deselect a selected radio or operate a disabled switch', async () => {
  const change=jest.fn();
  const view=await render(<ThemedToggle label="Ghost" value mode="radio" onValueChange={change} />);
  await userEvent.press(screen.getByRole('radio'));
  expect(change).not.toHaveBeenCalled();
  await view.rerender(<ThemedToggle label="Ghost" value={false} disabled onValueChange={change} />);
  await userEvent.press(screen.getByRole('switch'));
  expect(change).not.toHaveBeenCalled();
});
it('starts at its endpoint, reverses toward the newest value and stops on reduced motion', async () => {
  const original=AppState.currentState;
  AppState.currentState='active';
  jest.spyOn(AccessibilityInfo,'isReduceMotionEnabled').mockResolvedValue(false);
  let change!: (value:boolean) => void;
  const remove=jest.fn();
  jest.spyOn(AccessibilityInfo,'addEventListener').mockImplementation(((_event:string,listener:(value:boolean)=>void) => {change=listener;return {remove};}) as unknown as typeof AccessibilityInfo.addEventListener);
  const timing=jest.spyOn(Animated,'timing').mockReturnValue({start:jest.fn(),stop:jest.fn(),reset:jest.fn()});
  const stop=jest.spyOn(Animated.Value.prototype,'stopAnimation');
  const view=await render(<ThemedToggle label="Ghost" themeId="ghost" size="showcase" value={false} onValueChange={jest.fn()} />);
  expect(timing).not.toHaveBeenCalled();
  await view.rerender(<ThemedToggle label="Ghost" themeId="ghost" size="showcase" value onValueChange={jest.fn()} />);
  expect(timing).toHaveBeenLastCalledWith(expect.anything(),expect.objectContaining({toValue:1,useNativeDriver:false}));
  await view.rerender(<ThemedToggle label="Ghost" themeId="ghost" size="showcase" value={false} onValueChange={jest.fn()} />);
  expect(timing).toHaveBeenLastCalledWith(expect.anything(),expect.objectContaining({toValue:0}));
  await act(async () => { change(true); });
  expect(timing).toHaveBeenCalledTimes(2);
  await view.unmount();
  expect(stop).toHaveBeenCalled(); expect(remove).toHaveBeenCalled();
  AppState.currentState=original;
});
