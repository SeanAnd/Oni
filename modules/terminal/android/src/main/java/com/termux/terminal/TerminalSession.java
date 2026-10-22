package com.termux.terminal;

import java.nio.charset.StandardCharsets;
/** Oni external-session adapter. Never creates or signals a local Android subprocess. */
public final class TerminalSession extends TerminalOutput {
    public interface Transport {
        void write(byte[] bytes);
        void resize(int columns, int rows);
        void close();
    }
    private final Transport transport;
    private final TerminalSessionClient client;
    private TerminalEmulator emulator;
    private boolean running = true;
    private int exitStatus;
    public TerminalSession(Transport transport, TerminalSessionClient client) {
        this.transport = transport; this.client = client;
    }
    public void updateSize(int columns, int rows, int cellWidth, int cellHeight) {
        if (emulator == null) emulator = new TerminalEmulator(this, columns, rows, cellWidth, cellHeight, 2000, client);
        else emulator.resize(columns, rows, cellWidth, cellHeight);
        transport.resize(columns, rows);
    }
    public void append(byte[] bytes) {
        if (emulator == null) updateSize(80, 24, 8, 16);
        emulator.append(bytes, bytes.length); client.onTextChanged(this);
    }
    public void finished(int code) { running=false;exitStatus=code;client.onSessionFinished(this); }
    public TerminalEmulator getEmulator() { return emulator; }
    public void reset() { if(emulator!=null) emulator.reset(); }
    public String getTitle() { return emulator == null ? null : emulator.getTitle(); }
    public String getCwd() { return null; }
    public int getPid() { return -1; }
    public boolean isRunning() { return running; }
    public int getExitStatus() { return exitStatus; }
    public void finishIfRunning() { transport.close(); }
    @Override public void write(byte[] data, int offset, int count) {
        if(running) transport.write(java.util.Arrays.copyOfRange(data,offset,offset+count));
    }
    public void writeCodePoint(boolean escape, int point) {
        if(!Character.isValidCodePoint(point) || point>=0xd800 && point<=0xdfff) return;
        write((escape ? "\033" : "")+new String(Character.toChars(point)));
    }
    @Override public void titleChanged(String oldTitle, String newTitle) { client.onTitleChanged(this); }
    @Override public void onCopyTextToClipboard(String text) { client.onCopyTextToClipboard(this,text); }
    @Override public void onPasteTextFromClipboard() { client.onPasteTextFromClipboard(this); }
    @Override public void onBell() { client.onBell(this); }
    @Override public void onColorsChanged() { client.onColorsChanged(this); }
}
