/** Static require() calls are deliberate: Metro can discover and bundle every asset. */
export const assets = {
  logo: require('../../assets/oni/brand/oni-mark.png'),
  ghostLogo: require('../../assets/oni/brand/oni-ghost.png'),
  calligraphy: require('../../assets/oni/brand/oni-calligraphy.png'),
  enso: require('../../assets/oni/artwork/enso-landscape.png'),
  setupLandscape: require('../../assets/oni/artwork/setup-landscape.png'),
  terminalLandscape: require('../../assets/oni/artwork/terminal-landscape.png'),
  paper: require('../../assets/oni/textures/washi-paper.jpg'),
  ink: require('../../assets/oni/textures/ink-panel.jpg'),
  terminalInk: require('../../assets/oni/textures/terminal-ink.jpg'),
  crimson: require('../../assets/oni/textures/crimson-brush.jpg'),
  underline: require('../../assets/oni/textures/brush-underline.png'),
  icons: {
    recon: require('../../assets/oni/icons/recon.png'),
    sessions: require('../../assets/oni/icons/sessions.png'),
    reports: require('../../assets/oni/icons/reports.png'),
    terminal: require('../../assets/oni/icons/terminal.png'),
    nethunter: require('../../assets/oni/icons/nethunter.png'),
    metasploit: require('../../assets/oni/icons/metasploit.png'),
  },
};
