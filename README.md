# universal-theme-extension
Apply color themes universally to chrome! Any web page any theme! WHAT! O yes! 

## Development

Install Docker and a devcontainer-compatible editor (such as VS Code with the
Dev Containers extension), then open this repository in a devcontainer. The
container includes Node.js 24 LTS, Chromium, and a lightweight desktop.
The container relaxes Docker's seccomp restrictions to allow Chromium's own
sandbox to run; use it for local development, not as a production environment.

Open the forwarded port 6080 in your browser to access the desktop (the default
noVNC password is `vscode`). From the container terminal, run `chromium` to
open the browser on that desktop. Once the extension has a `manifest.json`,
visit `chrome://extensions`, enable **Developer mode**, and select **Load
unpacked** to choose the directory containing the manifest. Reload the
extension from that page after changing its files.
