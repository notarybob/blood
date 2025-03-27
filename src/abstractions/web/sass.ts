import * as vscode from "vscode";
let Sass = require("sass.js");

export async function compile(
  content: string,
  indentedSyntax: boolean,
  importUri: vscode.Uri
) {
  Sass.importer(async (request: any, done: any) => {
    if (request.path) {
      done();
    } else if (request.current) {
      let fileExtension = indentedSyntax ? ".sass" : ".scss";
      if (!request.current.endsWith(fileExtension)) {
        request.current += fileExtension;
      }

      let uri = vscode.Uri.joinPath(importUri, request.current);
      let content = await vscode.workspace.fs.readFile(uri);

      done({
        content,
      });
    }
  });

  return new Promise((resolve) => {
    Sass.compile(content, { indentedSyntax }, (result: any) =>
      resolve(result.text)
    );
  });
}
