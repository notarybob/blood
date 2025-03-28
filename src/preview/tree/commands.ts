import * as path from "path";
import { commands, ExtensionContext, Uri, window, workspace } from "vscode";
import { EXTENSION_NAME } from "../../constants";
import { store } from "../../store";
import { withProgress } from "../../utils";
import { refreshTreeView } from "./activeSwing";
import { CodeSwingDirectoryNode, CodeSwingFileNode } from "./nodes";

export function registerTreeViewCommands(context: ExtensionContext) {
  context.subscriptions.push(
    commands.registerCommand(
      `${EXTENSION_NAME}.addSwingFile`,
      async (node?: CodeSwingDirectoryNode) => {
        let file = await window.showInputBox({
          placeHolder: "Enter the name of the file you'd like to add",
        });

        if (!file) {
          return;
        }

        let filePath =
          node && node.directory ? `${node.directory}/${file}` : file;
        let uri = Uri.joinPath(store.activeSwing!.rootUri, filePath);

        await workspace.fs.writeFile(uri, new Uint8Array());
        window.showTextDocument(uri);
        refreshTreeView();
      }
    )
  );

  context.subscriptions.push(
    commands.registerCommand(
      `${EXTENSION_NAME}.uploadSwingFile`,
      async (node?: CodeSwingDirectoryNode) => {
        let files = await window.showOpenDialog({
          canSelectFiles: true,
          canSelectFolders: false,
          canSelectMany: true,
          openLabel: "Upload",
        });

        if (!files) {
          return;
        }

        await Promise.all(
          files.map(async (file) => {
            let contents = await workspace.fs.readFile(file);

            let fileName = path.basename(file.path);
            let filePath = node ? `${node.directory}/${fileName}` : fileName;
            let uri = Uri.joinPath(store.activeSwing!.rootUri, filePath);

            await workspace.fs.writeFile(uri, contents);
          })
        );

        refreshTreeView();

        // We're assuming the uploaded file impacts
        // the rendering of the swing.
        store.activeSwing!.webView.rebuildWebview();
      }
    )
  );

  context.subscriptions.push(
    commands.registerCommand(
      `${EXTENSION_NAME}.renameSwingFile`,
      async (node: CodeSwingFileNode) => {
        let file = await window.showInputBox({
          placeHolder: "Enter the name you'd like to rename this file to",
          value: node.file,
        });

        if (!file) {
          return;
        }

        let newUri = Uri.joinPath(store.activeSwing!.rootUri, file);

        await withProgress("Renaming file...", async () => {
          // If the file being renamed is dirty, then we
          // need to save it before renaming it. Otherwise,
          // VS Code will retain the old file and show it as
          // deleted, since they don't want to lose the changing.
          let visibleDocument = window.visibleTextEditors.find(
            (editor) =>
              editor.document.uri.toString() === node.resourceUri!.toString()
          );
          if (visibleDocument) {
            await visibleDocument.document.save();
          }

          await workspace.fs.rename(node.resourceUri!, newUri);
        });

        refreshTreeView();
      }
    )
  );

  context.subscriptions.push(
    commands.registerCommand(
      `${EXTENSION_NAME}.deleteSwingFile`,
      async (node: CodeSwingFileNode) => {
        let message = `Are you sure you want to delete the "${node.file}" file?`;
        if (await window.showInformationMessage(message, "Delete")) {
          await workspace.fs.delete(node.resourceUri!);
          refreshTreeView();
        }
      }
    )
  );
}
