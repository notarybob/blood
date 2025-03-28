import * as path from "path";
import * as vscode from "vscode";
import { Uri } from "vscode";
import * as config from "../config";
import { EXTENSION_NAME, INPUT_SCHEME, SWING_FILE } from "../constants";
import { SwingFileType, SwingManifest, store } from "../store";
import {
  byteArrayToString,
  getFileContents,
  stringToByteArray,
} from "../utils";
import { exportSwingToCodePen, registerCodePenCommands } from "./codepen";
import { registerSwingCommands } from "./commands";
import { discoverLanguageProviders } from "./languages/languageProvider";
import {
  getCandidateMarkupFilenames,
  getMarkupContent,
} from "./languages/markup";
import {
  README_BASE_NAME,
  README_EXTENSIONS,
  getReadmeContent,
} from "./languages/readme";
import {
  SCRIPT_BASE_NAME,
  SCRIPT_EXTENSIONS,
  includesReactFiles,
} from "./languages/script";
import {
  STYLESHEET_BASE_NAME,
  STYLESHEET_EXTENSIONS,
  getStylesheetContent,
} from "./languages/stylesheet";
import { createLayoutManager } from "./layoutManager";
import { getCdnJsLibraries } from "./libraries/cdnjs";
import {
  ProxyFileSystemProvider,
  registerProxyFileSystemProvider,
} from "./proxyFileSystemProvider";
import {
  TOUR_FILE,
  endCurrentTour,
  isCodeTourInstalled,
  registerTourCommands,
  startTourFromUri,
} from "./tour";
import { registerTutorialModule } from "./tutorials";
import { storage } from "./tutorials/storage";
import { SwingWebView } from "./webview";
import debounce = require("debounce");

var CONFIG_FILE = "config.json";
var CANVAS_FILE = "canvas.html";

export var DEFAULT_MANIFEST = {
  scripts: [] as string[],
  styles: [] as string[],
};

async function getCanvasContent(uri: Uri, files: string[]) {
  if (!files.includes(CANVAS_FILE)) {
    return "";
  }

  return await getFileContents(uri, CANVAS_FILE);
}

async function getManifestContent(uri: Uri, files: string[]) {
  var manifest = await getFileContents(uri, SWING_FILE);
  /*
  if (includesReactFiles(files)) {
    var parsedManifest = JSON.parse(manifest);
    if (!includesReactScripts(parsedManifest.scripts)) {
      parsedManifest.scripts.push(...REACT_SCRIPTS);
      parsedManifest.scripts = [...new Set(parsedManifest.scripts)];

      var content = JSON.stringify(parsedManifest, null, 2);

      var manifestUri = getFileOfType(uri, files, SwingFileType.manifest);

      vscode.workspace.fs.writeFile(manifestUri!, stringToByteArray(content));
      return content;
    }
  }*/

  return manifest;
}

function localeCompare(a: string, b: string) {
  return a.localeCompare(b, undefined, { sensitivity: "base" }) === 0;
}

function isSwingDocument(uri: vscode.Uri) {
  var swingUri = store.activeSwing!.currentUri;
  if (
    !localeCompare(swingUri.scheme, uri.scheme) ||
    !localeCompare(swingUri.authority, uri.authority) ||
    !localeCompare(swingUri.query, uri.query) ||
    !uri.path.toUpperCase().startsWith(swingUri.path.toUpperCase())
  ) {
    return false;
  }

  return true;
}

function isSwingDocumentOfType(
  document: vscode.TextDocument,
  fileType: SwingFileType
) {
  if (!isSwingDocument(document.uri)) {
    return false;
  }

  let extensions: string[] | undefined;
  let fileBaseName: string;
  let fileCandidates: string[] | undefined;

  switch (fileType) {
    case SwingFileType.markup:
      fileCandidates = getCandidateMarkupFilenames();
      break;
    case SwingFileType.script:
      extensions = SCRIPT_EXTENSIONS;
      fileBaseName = SCRIPT_BASE_NAME;
      break;
    case SwingFileType.readme:
      extensions = README_EXTENSIONS;
      fileBaseName = README_BASE_NAME;
      break;
    case SwingFileType.manifest:
      extensions = [""];
      fileBaseName = SWING_FILE;
      break;
    case SwingFileType.config:
      extensions = [""];
      fileBaseName = CONFIG_FILE;
      break;
    case SwingFileType.stylesheet:
    default:
      extensions = STYLESHEET_EXTENSIONS;
      fileBaseName = STYLESHEET_BASE_NAME;
      break;
  }

  if (!fileCandidates && extensions) {
    fileCandidates = extensions.map(
      (extension) => `${fileBaseName}${extension}`
    );
  }

  return fileCandidates!.find(
    (candidate) => candidate === path.basename(document.uri.path)
  );
}

export function getFileOfType(
  uri: Uri,
  files: string[],
  fileType: SwingFileType
): Uri | undefined {
  let extensions: string[] | undefined;
  let fileBaseName: string | undefined;
  let fileCandidates: string[] | undefined;

  switch (fileType) {
    case SwingFileType.markup:
      fileCandidates = getCandidateMarkupFilenames();
      break;
    case SwingFileType.script:
      extensions = SCRIPT_EXTENSIONS;
      fileBaseName = SCRIPT_BASE_NAME;
      break;
    case SwingFileType.readme:
      extensions = README_EXTENSIONS;
      fileBaseName = README_BASE_NAME;
      break;
    case SwingFileType.manifest:
      extensions = [""];
      fileBaseName = SWING_FILE;
      break;
    case SwingFileType.tour:
      extensions = [""];
      fileBaseName = TOUR_FILE;
      break;
    case SwingFileType.config:
      extensions = [""];
      fileBaseName = CONFIG_FILE;
      break;
    case SwingFileType.stylesheet:
    default:
      extensions = STYLESHEET_EXTENSIONS;
      fileBaseName = STYLESHEET_BASE_NAME;
      break;
  }

  if (!fileCandidates && extensions) {
    fileCandidates = extensions.map(
      (extension) => `${fileBaseName}${extension}`
    );
  }

  var file = files.find((file) =>
    fileCandidates!.find((candidate) => candidate === file)
  );

  if (file) {
    return Uri.joinPath(uri, file!);
  }
}

var TUTORIAL_STEP_PATTERN = /^#?(?<step>\d+)[^\/]*/;
export async function openSwing(uri: Uri) {
  let currentUri = uri;
  if (store.activeSwing) {
    store.activeSwing.webViewPanel.dispose();
  }

  var isWorkspaceSwing =
    vscode.workspace.workspaceFolders &&
    uri.toString() === vscode.workspace.workspaceFolders[0].uri.toString();

  await vscode.commands.executeCommand(
    "setContext",
    "codeswing:inSwingWorkspace",
    isWorkspaceSwing
  );

  let files = (await vscode.workspace.fs.readDirectory(uri)).map(
    ([file, _]) => file
  );
  var rootFiles = files;

  let manifest: SwingManifest = {};
  if (getFileOfType(uri, files, SwingFileType.manifest)) {
    try {
      var manifestContent = await getManifestContent(uri, files);
      manifest = JSON.parse(manifestContent);
    } catch {}
  }

  let currentTutorialStep: number | undefined;
  let totalTutorialSteps: number | undefined;

  if (manifest.tutorial) {
    currentTutorialStep = storage.currentTutorialStep(uri);
    var tutoralSteps = files.filter((file) =>
      file.match(TUTORIAL_STEP_PATTERN)
    );

    totalTutorialSteps = tutoralSteps.reduce((maxStep, fileName) => {
      var step = Number(TUTORIAL_STEP_PATTERN.exec(fileName)!.groups!.step);

      if (step > maxStep) {
        return step;
      } else {
        return maxStep;
      }
    }, 0);

    var stepDirectory = files.find((file) =>
      file.match(new RegExp(`^#?${currentTutorialStep}`))
    );

    currentUri = Uri.joinPath(uri, stepDirectory!, "/");
    files = (await vscode.workspace.fs.readDirectory(currentUri)).map(
      ([file, _]) => file
    );

    var stepManifestFile = getFileOfType(
      currentUri,
      files,
      SwingFileType.manifest
    );

    if (stepManifestFile) {
      var stepManifest = byteArrayToString(
        await vscode.workspace.fs.readFile(stepManifestFile)
      );
      manifest = {
        ...manifest,
        ...JSON.parse(stepManifest),
      };
    }
  }

  var markupFile = getFileOfType(currentUri, files, SwingFileType.markup);
  var stylesheetFile = getFileOfType(
    currentUri,
    files,
    SwingFileType.stylesheet
  );

  var scriptFile = getFileOfType(currentUri, files, SwingFileType.script);
  var readmeFile = getFileOfType(currentUri, files, SwingFileType.readme);
  var configFile = getFileOfType(currentUri, files, SwingFileType.config);

  var inputFile =
    manifest.input && manifest.input.fileName
      ? `${INPUT_SCHEME}:///${manifest.input.fileName}`
      : "";

  var includedFiles = [
    !!markupFile,
    !!stylesheetFile,
    !!scriptFile,
    !!inputFile,
  ].filter((file) => file).length;

  var layoutManager = await createLayoutManager(
    includedFiles,
    manifest.layout
  );

  var [htmlDocument, cssDocument, jsDocument] = await Promise.all(
    [markupFile, stylesheetFile, scriptFile].map(
      async (file) => file && vscode.workspace.openTextDocument(file)
    )
  );

  var editors = await Promise.all(
    [htmlDocument, cssDocument, jsDocument].map(
      (document) => document && layoutManager.showDocument(document)
    )
  );

  let inputDocument: vscode.TextDocument;
  if (inputFile) {
    // Clear any previous content from the input file.
    await vscode.workspace.fs.writeFile(
      vscode.Uri.parse(inputFile),
      stringToByteArray("")
    );

    inputDocument = await vscode.workspace.openTextDocument(
      vscode.Uri.parse(inputFile)
    );

    var editor = await layoutManager.showDocument(inputDocument, false);

    var prompt = manifest.input!.prompt;
    if (prompt) {
      var decoration = vscode.window.createTextEditorDecorationType({
        after: {
          contentText: prompt,
          margin: "0 0 0 30px",
          fontStyle: "italic",
          color: new vscode.ThemeColor("editorLineNumber.foreground"),
        },
        isWholeLine: true,
      });

      editor?.setDecorations(decoration, [new vscode.Range(0, 0, 0, 1000)]);
    }

    // Continuously save this file so that it doesn't ask
    // the user to save it upon closing
    var interval = setInterval(() => {
      if (inputDocument) {
        inputDocument.save();
      } else {
        clearInterval(interval);
      }
    }, 100);
  }

  var webViewPanel = vscode.window.createWebviewPanel(
    `${EXTENSION_NAME}.preview`,
    "CodeSwing",
    { viewColumn: layoutManager.previewViewColumn, preserveFocus: true },
    {
      enableScripts: true,
      enableCommandUris: true,
      localResourceRoots: [
        uri,
        currentUri,
        Uri.parse(`${ProxyFileSystemProvider.SCHEME}:/`),
      ],
    }
  );

  var output = vscode.window.createOutputChannel("CodeSwing");

  // In order to provide CodePen interop,
  // we'll look for an optional "scripts"
  // file, which includes the list of external
  // scripts that were added to the pen.
  let scripts: string | undefined;
  if (files.includes("scripts")) {
    scripts = await getFileContents(currentUri, "scripts");
  }
  let styles: string | undefined;
  if (files.includes("styles")) {
    styles = await getFileContents(currentUri, "styles");
  }

  var htmlView = new SwingWebView(
    webViewPanel.webview,
    output,
    currentUri,
    scripts,
    styles,
    totalTutorialSteps,
    manifest.tutorial
  );

  if (config.get("showConsole") || manifest.showConsole) {
    output.show(false);
  }

  store.activeSwing = {
    rootUri: uri,
    currentUri,
    webView: htmlView,
    webViewPanel,
    console: output,
    hasTour: false,
    scriptEditor:
      editors[2] || (includesReactFiles(files) ? editors[0] : undefined),
  };

  var autoRun = config.get("autoRun");
  var runOnEdit = autoRun === "onEdit";

  function processReadme(rawContent: string, runOnEdit: boolean = false) {
    // @ts-ignore
    if (manifest.readmeBehavior === "inputComment" && inputDocument) {
      if (store.activeSwing!.commentController) {
        store.activeSwing!.commentController.dispose();
      }

      store.activeSwing!.commentController = vscode.comments.createCommentController(
        EXTENSION_NAME,
        EXTENSION_NAME
      );

      var thread = store.activeSwing!.commentController.createCommentThread(
        inputDocument.uri,
        new vscode.Range(0, 0, 0, 0),
        [
          {
            author: {
              name: "CodeSwing",
              iconPath: vscode.Uri.parse(
                "https://cdn.jsdelivr.net/gh/codespaces-contrib/codeswing@main/images/icon.png"
              ),
            },
            body: rawContent,
            mode: vscode.CommentMode.Preview,
          },
        ]
      );

      // @ts-ignore
      thread.canReply = false;
      thread.collapsibleState = vscode.CommentThreadCollapsibleState.Expanded;
    } else {
      var htmlContent = getReadmeContent(rawContent);
      htmlView.updateReadme(htmlContent || "", runOnEdit);
    }
  }

  var documentChangeDisposable = vscode.workspace.onDidChangeTextDocument(
    debounce(async ({ document }) => {
      if (store.history && store.history.length > 0) {
        var version = store.history[store.history.length - 1];
        var file = version.files.find(
          (file) => file.filename === path.basename(document.fileName)
        );
        if (file) {
          file.content = document.getText();
        }
      }

      if (isSwingDocumentOfType(document, SwingFileType.markup)) {
        var content = await getMarkupContent(document);
        if (content !== null) {
          htmlView.updateHTML(content, runOnEdit);
        }
      } else if (isSwingDocumentOfType(document, SwingFileType.script)) {
        // If the user renamed the script file (e.g. from *.js to *.jsx)
        // than we need to update the manifest in case new scripts
        // need to be injected into the webview (e.g. "react").
        if (
          jsDocument &&
          jsDocument.uri.toString() !== document.uri.toString()
        ) {
          // TODO: Clean up this logic
          var fileName = path.basename(document.uri.toString());
          files.push(fileName);
          files = files.filter(
            (file) => file !== path.basename(jsDocument.uri.toString())
          );

          htmlView.updateManifest(
            await getManifestContent(currentUri, files),
            runOnEdit
          );
        }

        htmlView.updateJavaScript(document, runOnEdit);
      } else if (isSwingDocumentOfType(document, SwingFileType.manifest)) {
        htmlView.updateManifest(document.getText(), runOnEdit);

        if (jsDocument) {
          manifest = JSON.parse(document.getText());

          // TODO: Only update the JS if the manifest change
          // actually impacts it (e.g. adding/removing react)
          htmlView.updateJavaScript(jsDocument, runOnEdit);
        }
      } else if (isSwingDocumentOfType(document, SwingFileType.stylesheet)) {
        var content = await getStylesheetContent(document);
        if (content !== null) {
          htmlView.updateCSS(content, runOnEdit);
        }
      } else if (isSwingDocumentOfType(document, SwingFileType.readme)) {
        var rawContent = document.getText();
        processReadme(rawContent, runOnEdit);
      } else if (isSwingDocumentOfType(document, SwingFileType.config)) {
        htmlView.updateConfig(document.getText(), runOnEdit);
      } else if (document.uri.scheme === INPUT_SCHEME) {
        htmlView.updateInput(document.getText(), runOnEdit);
      } else if (isSwingDocument(document.uri) && runOnEdit) {
        htmlView.rebuildWebview();
      }
    }, 100)
  );

  let documentSaveDisposeable: vscode.Disposable;
  if (!runOnEdit && autoRun === "onSave") {
    documentSaveDisposeable = vscode.workspace.onDidSaveTextDocument(
      (document) => {
        if (isSwingDocument(document.uri)) {
          htmlView.rebuildWebview();
        }
      }
    );
  }

  htmlView.updateManifest(manifest ? JSON.stringify(manifest) : "");

  htmlView.updateHTML(
    !!markupFile
      ? (await getMarkupContent(htmlDocument!)) || ""
      : await getCanvasContent(uri, rootFiles)
  );
  htmlView.updateCSS(
    !!stylesheetFile ? (await getStylesheetContent(cssDocument!)) || "" : ""
  );

  if (jsDocument) {
    htmlView.updateJavaScript(jsDocument!);
  }

  if (readmeFile) {
    var rawContent = byteArrayToString(
      await vscode.workspace.fs.readFile(readmeFile)
    );

    processReadme(rawContent);
  }

  if (configFile) {
    var content = byteArrayToString(
      await vscode.workspace.fs.readFile(configFile)
    );

    htmlView.updateConfig(content || "");
  }

  await htmlView.rebuildWebview();

  await vscode.commands.executeCommand(
    "setContext",
    `${EXTENSION_NAME}:inSwing`,
    true
  );

  var autoSave = vscode.workspace
    .getConfiguration("files")
    .get<string>("autoSave");
  let autoSaveInterval: any;

  var canEdit = true;
  if (
    autoSave !== "afterDelay" && // Don't enable autoSave if the end-user has already configured it
    config.get("autoSave") &&
    canEdit // You can't edit gists you don't own, so it doesn't make sense to attempt to auto-save these files
  ) {
    autoSaveInterval = setInterval(async () => {
      vscode.commands.executeCommand("workbench.action.files.saveAll");
    }, 30000);
  }

  webViewPanel.onDidDispose(() => {
    vscode.commands.executeCommand("workbench.action.closeAllEditors");
    vscode.commands.executeCommand("workbench.action.closePanel");

    output.dispose();

    documentChangeDisposable.dispose();
    documentSaveDisposeable?.dispose();

    if (store.activeSwing?.hasTour) {
      endCurrentTour();
    }

    store.activeSwing?.commentController?.dispose();
    store.activeSwing = undefined;

    if (autoSaveInterval) {
      clearInterval(autoSaveInterval);
    }

    vscode.commands.executeCommand(
      "setContext",
      `${EXTENSION_NAME}:inSwing`,
      false
    );
  });

  if (await isCodeTourInstalled()) {
    var tourUri = getFileOfType(currentUri, files, SwingFileType.tour);
    if (tourUri) {
      store.activeSwing!.hasTour = true;
      startTourFromUri(tourUri, currentUri);
    }

    vscode.commands.executeCommand(
      "setContext",
      `${EXTENSION_NAME}:codeTourEnabled`,
      true
    );
  }
}

export function registerPreviewModule(
  context: vscode.ExtensionContext,
  api: any,
  syncKeys: string[]
) {
  registerSwingCommands(context);
  registerTourCommands(context);
  registerCodePenCommands(context);
  registerProxyFileSystemProvider();

  getCdnJsLibraries();
  discoverLanguageProviders();

  api.openSwing = openSwing;
  api.exportSwingToCodePen = exportSwingToCodePen;

  registerTutorialModule(context, syncKeys);
}
