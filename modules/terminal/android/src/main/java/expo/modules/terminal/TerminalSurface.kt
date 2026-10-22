package expo.modules.terminal

import android.content.Context
import android.graphics.Color
import android.view.inputmethod.InputMethodManager
import android.widget.FrameLayout
import com.termux.view.TerminalView
import expo.modules.kotlin.AppContext
import expo.modules.kotlin.views.ExpoView

class TerminalSurface(context: Context, appContext: AppContext): ExpoView(context,appContext) {
  override val shouldUseAndroidLayout = true
  private val terminal=TerminalView(context,null)
  private val client=OniTerminalClient(terminal)
  private var background=Color.rgb(16,17,16)
  private var foreground=Color.rgb(248,245,236)
  private val sessionChanged: () -> Unit = { refresh(true) }
  init {
    TerminalRuntime.initialize(context)
    if (android.os.Build.VERSION.SDK_INT >= 26) terminal.defaultFocusHighlightEnabled = false
    terminal.isFocusable = true
    terminal.isFocusableInTouchMode = true
    terminal.setTerminalViewClient(client)
    terminal.setTextSize((16*resources.displayMetrics.scaledDensity).toInt())
    terminal.setIsTerminalViewKeyLoggingEnabled(false)
    addView(terminal,FrameLayout.LayoutParams(-1,-1))
  }
  fun colors(bg:String,fg:String) {
    val nextBackground=Color.parseColor(bg);val nextForeground=Color.parseColor(fg)
    if (background==nextBackground && foreground==nextForeground) return
    background=nextBackground;foreground=nextForeground;refresh()
  }
  fun key(value:String) {
    when(value){
      "keyboard" -> {terminal.requestFocus();(context.getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager).showSoftInput(terminal,InputMethodManager.SHOW_IMPLICIT)}
      "copy" -> { terminal.selectedText?.let { TerminalRuntime.copyClipboard(it) }; terminal.stopTextSelectionMode() }
      "paste" -> TerminalRuntime.pasteClipboard()
      "ctrl" -> {client.control=!client.control}
      else -> TerminalRuntime.input(value.toByteArray())
    }
  }
  private fun refresh(screenUpdated: Boolean = false) {
    val session=TerminalRuntime.session
    if(session!=null && terminal.mTermSession!==session)terminal.attachSession(session)
    terminal.setBackgroundColor(background)
    session?.emulator?.let {
      it.mColors.mCurrentColors[256]=foreground
      it.mColors.mCurrentColors[257]=background
      it.mColors.mCurrentColors[258]=foreground
    }
    if (screenUpdated) terminal.onScreenUpdated()
    terminal.invalidate()
  }
  override fun onLayout(changed: Boolean, left: Int, top: Int, right: Int, bottom: Int) {
    super.onLayout(changed, left, top, right, bottom)
    // Attachment can precede Yoga's first non-zero layout.
    terminal.updateSize()
    refresh()
  }
  override fun onAttachedToWindow(){
    super.onAttachedToWindow()
    TerminalRuntime.changed=sessionChanged
    requestLayout()
    refresh(true)
  }
  override fun onDetachedFromWindow(){
    // A previous surface may detach after its replacement has already attached.
    if (TerminalRuntime.changed === sessionChanged) TerminalRuntime.changed=null
    super.onDetachedFromWindow()
  }
}
