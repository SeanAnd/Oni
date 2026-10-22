package expo.modules.terminal
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
class TerminalModule:Module() {
  override fun definition()=ModuleDefinition {
    Name("OniTerminal")
    OnCreate { appContext.reactContext?.let { TerminalRuntime.initialize(it) } }
    AsyncFunction("detect") Coroutine { -> withContext(Dispatchers.IO){TerminalRuntime.detect()} }
    Function("status") { TerminalRuntime.summary() }
    AsyncFunction("start") Coroutine { token:String,preset:String -> withContext(Dispatchers.IO){TerminalRuntime.start(token,preset)} }
    AsyncFunction("close") Coroutine { -> withContext(Dispatchers.IO){TerminalRuntime.closeSession()} }
    View(TerminalSurface::class) {
      Prop("palette") {view:TerminalSurface,colors:Map<String,String> -> view.colors(colors["background"] ?: "#101110",colors["foreground"] ?: "#f8f5ec")}
      AsyncFunction("sendKey") {view:TerminalSurface,value:String -> view.key(value)}
    }
  }
}
