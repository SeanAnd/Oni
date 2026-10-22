import { hideNativeSplash } from './startup/nativeSplash';
import { Component, type ReactNode } from 'react';
import { SafeAreaView } from 'react-native-safe-area-context';
import { ActionButton } from './ActionButton';
import { Body, PageHeader, Screen } from './Screen';
/** Keep failed local initialization recoverable; never clear stored work as a repair. */
export class ApplicationBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <SafeAreaView onLayout={() => { void hideNativeSplash(); }} style={{ flex: 1 }}><Screen><PageHeader title="Unable to open the workstation" /><Body>Local initialization did not finish. Your stored data has not been reset.</Body><ActionButton label="Try again" onPress={() => this.setState({ failed: false })} /></Screen></SafeAreaView>;
  }
}
