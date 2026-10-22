package expo.modules.terminal;
import com.termux.terminal.*;
public class TerminalCallbacks implements TerminalSessionClient {

public void onTextChanged(TerminalSession session) { TerminalRuntime.INSTANCE.redraw(); }
public void onTitleChanged(TerminalSession session) {}
public void onSessionFinished(TerminalSession session) { TerminalRuntime.INSTANCE.redraw(); }
public void onCopyTextToClipboard(TerminalSession session, String text) { TerminalRuntime.INSTANCE.copyClipboard(text); }
public void onPasteTextFromClipboard(TerminalSession session) { TerminalRuntime.INSTANCE.pasteClipboard(); }
public void onBell(TerminalSession session) {}
public void onColorsChanged(TerminalSession session) { TerminalRuntime.INSTANCE.redraw(); }
public void onTerminalCursorStateChange(boolean state) {}
public void setTerminalShellPid(TerminalSession session,int pid) {}
public Integer getTerminalCursorStyle() { return 0; }
public void logError(String tag,String message) {}
public void logWarn(String tag,String message) {}
public void logInfo(String tag,String message) {}
public void logDebug(String tag,String message) {}
public void logVerbose(String tag,String message) {}
public void logStackTraceWithMessage(String tag,String message,Exception error) {}
public void logStackTrace(String tag,Exception error) {}
}
