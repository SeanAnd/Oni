package expo.modules.terminal;
import com.termux.terminal.*;
import com.termux.view.*;
import android.view.*;
public class OniTerminalClient implements TerminalViewClient {

public boolean control=false;
private final TerminalView view;
public OniTerminalClient(TerminalView view) {this.view=view;}
public float onScale(float value) {return 1;}
public void onSingleTapUp(MotionEvent e) { view.requestFocus(); ((android.view.inputmethod.InputMethodManager)view.getContext().getSystemService(android.content.Context.INPUT_METHOD_SERVICE)).showSoftInput(view,0); }
public boolean shouldBackButtonBeMappedToEscape() {return false;}
public boolean shouldEnforceCharBasedInput() {return true;}
public boolean shouldUseCtrlSpaceWorkaround() {return false;}
public boolean isTerminalViewSelected() {return view.hasFocus();}
public void copyModeChanged(boolean value) {}
public boolean onKeyDown(int code, KeyEvent e, TerminalSession session) {return false;}
public boolean onKeyUp(int code, KeyEvent e) {return false;}
public boolean onLongPress(MotionEvent e) {return false;}
public boolean readControlKey() {boolean result=control;control=false;return result;}
public boolean readAltKey() {return false;}
public boolean readShiftKey() {return false;}
public boolean readFnKey() {return false;}
public boolean onCodePoint(int code,boolean ctrl,TerminalSession session) {return false;}
public void onEmulatorSet() {}
public void logError(String tag,String message) {}
public void logWarn(String tag,String message) {}
public void logInfo(String tag,String message) {}
public void logDebug(String tag,String message) {}
public void logVerbose(String tag,String message) {}
public void logStackTraceWithMessage(String tag,String message,Exception error) {}
public void logStackTrace(String tag,Exception error) {}
}
