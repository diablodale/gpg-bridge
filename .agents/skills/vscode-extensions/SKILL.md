---
name: vscode-extensions
description: Expert guidance for building Visual Studio Code extensions. Use when the user wants to create, develop, or modify VS Code extensions - including commands, views, language support, debuggers, themes, webviews, and more. Covers project setup, VS Code API, contribution points, activation events, testing, and publishing.
license: MIT
---

# VS Code Extension Development

Build powerful Visual Studio Code extensions using the official VS Code Extension API. This skill covers the complete extension development lifecycle from scaffolding to publishing.

## When to Use This Skill

Use this skill when building:
- **Command extensions**: Custom commands and keybindings
- **UI extensions**: Custom views, webviews, tree views, status bar items
- **Language support**: Syntax highlighting, IntelliSense, diagnostics, formatters
- **Debugger extensions**: Debug adapters for custom runtimes
- **Theme extensions**: Color themes, file icon themes, product icon themes
- **Workbench extensions**: Explorer integration, SCM providers, custom editors

## Quick Start: Creating an Extension

### 1. Scaffold a New Extension

Use Yeoman and the VS Code Extension Generator:

```bash
# Install globally (one-time)
npm install -g yo generator-code

# Or use npx (no installation)
npx --package yo --package generator-code -- yo code
```

Choose from:
- **New Extension (TypeScript)** - Recommended for most extensions
- **New Extension (JavaScript)** - If you prefer JavaScript
- **New Color Theme** - Color theme extension
- **New Language Support** - Language grammar extension
- **New Code Snippets** - Snippet collection

Fill out the prompts:
```bash
? What type of extension do you want to create? New Extension (TypeScript)
? What's the name of your extension? my-extension
? What's the identifier of your extension? my-extension
? What's the description of your extension? My awesome extension
? Initialize a git repository? Yes
? Which bundler to use? esbuild
? Which package manager to use? npm
```

### 2. Understanding the File Structure

```
.
├── .vscode/
│   ├── launch.json          # Debug configuration
│   └── tasks.json           # Build tasks
├── src/
│   └── extension.ts         # Extension entry point
├── package.json             # Extension manifest
├── tsconfig.json            # TypeScript configuration
└── README.md                # Extension documentation
```

### 3. Run and Debug

1. Open the extension folder in VS Code
2. Press `F5` or run **Debug: Start Debugging**
3. A new Extension Development Host window opens
4. Test your extension in this window
5. Set breakpoints in your code to debug

## Extension Anatomy

### The Extension Manifest (package.json)

The `package.json` file is the extension manifest that declares:

```json
{
  "name": "my-extension",
  "displayName": "My Extension",
  "description": "My awesome extension",
  "version": "0.0.1",
  "publisher": "my-publisher",
  "engines": {
    "vscode": "^1.74.0"
  },
  "categories": ["Other"],
  "activationEvents": [],
  "main": "./out/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "my-extension.helloWorld",
        "title": "Hello World"
      }
    ]
  },
  "scripts": {
    "vscode:prepublish": "npm run compile",
    "compile": "tsc -p ./",
    "watch": "tsc -watch -p ./"
  },
  "devDependencies": {
    "@types/vscode": "^1.74.0",
    "@types/node": "^18.x",
    "typescript": "^5.0.0"
  }
}
```

**Key Fields:**
- `name` + `publisher`: Creates unique ID `<publisher>.<name>`
- `engines.vscode`: Minimum VS Code version required
- `activationEvents`: When your extension activates (often auto-detected)
- `main`: Entry point file
- `contributes`: Static declarations (commands, menus, views, etc.)
- `categories`: Extension Marketplace categories

### The Extension Entry Point (extension.ts)

```typescript
import * as vscode from 'vscode';

// Called when extension is activated
export function activate(context: vscode.ExtensionContext) {
  console.log('Extension "my-extension" is now active!');

  // Register a command
  let disposable = vscode.commands.registerCommand(
    'my-extension.helloWorld',
    () => {
      vscode.window.showInformationMessage('Hello World!');
    }
  );

  // Add to subscriptions for cleanup
  context.subscriptions.push(disposable);
}

// Called when extension is deactivated
export function deactivate() {
  // Cleanup code here
}
```

**Key Concepts:**
- `activate()`: Called when activation event fires
- `deactivate()`: Called on shutdown (optional, for cleanup)
- `context.subscriptions`: Auto-cleanup on deactivation
- Return a Promise from `deactivate()` if async cleanup needed

## Activation Events

Activation events determine when your extension loads. Starting with VS Code 1.74.0, many activation events are **auto-detected** from contribution points.

### Common Activation Events

```json
{
  "activationEvents": [
    // Activated when specific command is invoked (auto-detected)
    "onCommand:my-extension.myCommand",

    // Activated when file of specific language is opened
    "onLanguage:python",
    "onLanguage:javascript",

    // Activated when workspace contains file matching pattern
    "workspaceContains:**/.editorconfig",

    // Activated when specific view is opened (auto-detected)
    "onView:myCustomView",

    // Activated when file system scheme is used
    "onFileSystem:sftp",

    // Activated when debug session starts
    "onDebug",
    "onDebugResolve:node",

    // Activated when webview needs to be restored
    "onWebviewPanel:myWebview",

    // Activated when custom editor is opened
    "onCustomEditor:myEditor.pawDraw",

    // Activated some time after VS Code starts (recommended over *)
    "onStartupFinished",

    // Activated on VS Code startup (use sparingly!)
    "*"
  ]
}
```

**Auto-Detected Activation Events (VS Code 1.74+):**
- Commands declared in `contributes.commands`
- Views declared in `contributes.views`
- Custom editors declared in `contributes.customEditors`
- Languages declared in `contributes.languages`
- Tasks declared in `contributes.taskDefinitions`

**Best Practice:** Use specific activation events rather than `"*"` to improve startup performance.

## Contribution Points

Contribution points are static declarations in `package.json` that extend VS Code functionality.

### Commands

```json
{
  "contributes": {
    "commands": [
      {
        "command": "my-extension.myCommand",
        "title": "My Command",
        "category": "My Extension",
        "icon": {
          "light": "resources/light.svg",
          "dark": "resources/dark.svg"
        },
        "enablement": "editorLangId == javascript"
      }
    ]
  }
}
```

Register the command implementation:

```typescript
vscode.commands.registerCommand('my-extension.myCommand', () => {
  vscode.window.showInformationMessage('Command executed!');
});
```

### Command Naming Conventions

Understanding command registration and contribution is crucial:

**Registration vs. Contribution:**
- **`registerCommand()`**: Makes command available to:
  - Be invoked programmatically via `executeCommand()`
  - Be bound to keybindings
  - Be called from other extensions
  - Be used in internal logic
- **`contributes.commands` in package.json**: Additionally makes command:
  - Visible in Command Palette (Ctrl+Shift+P)
  - Discoverable by users
  - Available in command pickers and UI menus

**Command ID Format:**

```
<publisher>.<extension-name>.<command-name>
```

Examples:
- `myPublisher.myExtension.doSomething`
- `vscode.open` (built-in)
- `git.commit` (extension command)

**Internal vs. Public Commands:**

Use underscore prefix for internal/private commands not intended for direct user invocation:

```typescript
// Internal command - not listed in contributes.commands
vscode.commands.registerCommand('_myExtension.internalHelper', () => {
  // Internal logic only called programmatically
});

// Public command - listed in contributes.commands
vscode.commands.registerCommand('myExtension.userCommand', () => {
  // Can be called by users from Command Palette
});
```

**Command Title Guidelines:**

When contributing commands, follow these title conventions:

- **Use title-style capitalization**: Capitalize main words
- **Start with a verb**: Describe the action (e.g., "Open", "Close", "Format")
- **Include target noun**: What the action affects
- **Don't use "command"**: Redundant in the context
- **Don't capitalize short prepositions**: (on, to, in, of, with, for) unless first/last word

Good examples:
- ✅ `"Open Settings"`
- ✅ `"Format Document"`
- ✅ `"Show References"`
- ✅ `"Toggle Line Comment"`

Avoid:
- ❌ `"Open settings"` (not title-case)
- ❌ `"settings"` (no verb)
- ❌ `"Open Settings Command"` (redundant "Command")

**Category Usage:**

Group related commands using categories:

```json
{
  "commands": [
    {
      "command": "myExtension.action1",
      "title": "Action 1",
      "category": "My Extension"
    }
  ]
}
```

This displays as "My Extension: Action 1" in the Command Palette, helping users find your commands.

**Activation Events Note:**

For VS Code 1.74.0+, commands contributed in `package.json` automatically activate your extension. For earlier versions or internal commands, you may need explicit `onCommand` activation events:

```json
{
  "activationEvents": [
    "onCommand:myExtension.command"
  ]
}
```

You **must** define activation events for internal commands (not in `contributes.commands`) that can be:
- Invoked via Command Palette
- Bound to keybindings
- Called from UI elements
- Exposed as API to other extensions

### Menus

Add commands to various menus:

```json
{
  "contributes": {
    "menus": {
      "commandPalette": [
        {
          "command": "my-extension.myCommand",
          "when": "editorLangId == javascript"
        }
      ],
      "editor/context": [
        {
          "command": "my-extension.myCommand",
          "when": "editorHasSelection",
          "group": "navigation"
        }
      ],
      "editor/title": [
        {
          "command": "my-extension.myCommand",
          "when": "resourceLangId == markdown",
          "group": "navigation"
        }
      ],
      "view/title": [
        {
          "command": "my-extension.refreshView",
          "when": "view == myCustomView",
          "group": "navigation"
        }
      ],
      "view/item/context": [
        {
          "command": "my-extension.editItem",
          "when": "view == myCustomView && viewItem == editableItem",
          "group": "inline"
        }
      ]
    }
  }
}
```

**Available Menu Locations:**
- `commandPalette`: Command Palette (Ctrl+Shift+P)
- `editor/context`: Editor context menu
- `editor/title`: Editor title bar
- `editor/title/context`: Editor title context menu
- `explorer/context`: Explorer context menu
- `view/title`: Custom view title bar
- `view/item/context`: Custom view item context menu
- `scm/title`: Source control view title
- `debug/toolBar`: Debug toolbar
- Many more...

### Configuration

```json
{
  "contributes": {
    "configuration": {
      "title": "My Extension",
      "properties": {
        "myExtension.enable": {
          "type": "boolean",
          "default": true,
          "description": "Enable my extension"
        },
        "myExtension.maxItems": {
          "type": "number",
          "default": 10,
          "minimum": 1,
          "maximum": 100,
          "description": "Maximum number of items"
        },
        "myExtension.mode": {
          "type": "string",
          "enum": ["auto", "manual", "disabled"],
          "enumDescriptions": [
            "Automatic mode",
            "Manual mode",
            "Disabled"
          ],
          "default": "auto",
          "description": "Operation mode"
        }
      }
    }
  }
}
```

Read configuration values:

```typescript
const config = vscode.workspace.getConfiguration('myExtension');
const enabled = config.get<boolean>('enable', true);
const maxItems = config.get<number>('maxItems', 10);

// Listen for configuration changes
vscode.workspace.onDidChangeConfiguration(e => {
  if (e.affectsConfiguration('myExtension.enable')) {
    // Handle configuration change
  }
});
```

### Keybindings

```json
{
  "contributes": {
    "keybindings": [
      {
        "command": "my-extension.myCommand",
        "key": "ctrl+alt+k",
        "mac": "cmd+alt+k",
        "when": "editorTextFocus"
      }
    ]
  }
}
```

### Views and View Containers

Create custom sidebar views:

```json
{
  "contributes": {
    "viewsContainers": {
      "activitybar": [
        {
          "id": "my-container",
          "title": "My Container",
          "icon": "resources/icon.svg"
        }
      ]
    },
    "views": {
      "my-container": [
        {
          "id": "myView",
          "name": "My View",
          "when": "workspaceHasFiles"
        }
      ]
    }
  }
}
```

Implement the view with TreeView:

```typescript
class MyTreeDataProvider implements vscode.TreeDataProvider<MyItem> {
  private _onDidChangeTreeData = new vscode.EventEmitter<MyItem | undefined>();
  readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

  refresh(): void {
    this._onDidChangeTreeData.fire(undefined);
  }

  getTreeItem(element: MyItem): vscode.TreeItem {
    return element;
  }

  getChildren(element?: MyItem): Thenable<MyItem[]> {
    // Return child items
    return Promise.resolve([]);
  }
}

// Register the tree view
const treeDataProvider = new MyTreeDataProvider();
vscode.window.createTreeView('myView', { treeDataProvider });
```

### Languages

```json
{
  "contributes": {
    "languages": [
      {
        "id": "mylang",
        "extensions": [".mylang"],
        "aliases": ["MyLang", "mylang"],
        "configuration": "./language-configuration.json"
      }
    ],
    "grammars": [
      {
        "language": "mylang",
        "scopeName": "source.mylang",
        "path": "./syntaxes/mylang.tmLanguage.json"
      }
    ]
  }
}
```

### Themes

```json
{
  "contributes": {
    "themes": [
      {
        "label": "My Dark Theme",
        "uiTheme": "vs-dark",
        "path": "./themes/dark.json"
      }
    ],
    "iconThemes": [
      {
        "id": "my-icons",
        "label": "My Icons",
        "path": "./icons/icon-theme.json"
      }
    ]
  }
}
```

## VS Code API Usage

### Window API

```typescript
// Show messages
vscode.window.showInformationMessage('Info message');
vscode.window.showWarningMessage('Warning message');
vscode.window.showErrorMessage('Error message');

// Show message with actions
const answer = await vscode.window.showInformationMessage(
  'Do you want to continue?',
  'Yes',
  'No'
);
if (answer === 'Yes') {
  // User clicked Yes
}

// Show input box
const result = await vscode.window.showInputBox({
  prompt: 'Enter a value',
  placeHolder: 'Type here',
  validateInput: (value) => {
    return value.length < 3 ? 'Must be at least 3 characters' : null;
  }
});

// Show quick pick
const selected = await vscode.window.showQuickPick(
  ['Option 1', 'Option 2', 'Option 3'],
  {
    placeHolder: 'Select an option',
    canPickMany: false
  }
);

// Progress notification
vscode.window.withProgress(
  {
    location: vscode.ProgressLocation.Notification,
    title: 'Processing',
    cancellable: true
  },
  async (progress, token) => {
    token.onCancellationRequested(() => {
      console.log('User canceled');
    });

    progress.report({ increment: 0, message: 'Starting...' });
    await doWork();
    progress.report({ increment: 50, message: 'Half done...' });
    await doMoreWork();
    progress.report({ increment: 50, message: 'Complete!' });
  }
);

// Open external URL
vscode.env.openExternal(vscode.Uri.parse('https://example.com'));

// Access active text editor
const editor = vscode.window.activeTextEditor;
if (editor) {
  const document = editor.document;
  const selection = editor.selection;
  const text = document.getText(selection);
}
```

### Workspace API

```typescript
// Get workspace folders
const folders = vscode.workspace.workspaceFolders;
if (folders && folders.length > 0) {
  const rootPath = folders[0].uri.fsPath;
}

// Find files in workspace
const files = await vscode.workspace.findFiles(
  '**/*.ts',          // include pattern
  '**/node_modules/**' // exclude pattern
);

// Read file
const uri = vscode.Uri.file('/path/to/file.txt');
const content = await vscode.workspace.fs.readFile(uri);
const text = Buffer.from(content).toString('utf8');

// Write file
const data = Buffer.from('Hello, World!', 'utf8');
await vscode.workspace.fs.writeFile(uri, data);

// Watch file system
const watcher = vscode.workspace.createFileSystemWatcher('**/*.ts');
watcher.onDidCreate(uri => console.log('Created:', uri));
watcher.onDidChange(uri => console.log('Changed:', uri));
watcher.onDidDelete(uri => console.log('Deleted:', uri));

// Listen for document events
vscode.workspace.onDidOpenTextDocument(doc => {
  console.log('Opened:', doc.fileName);
});

vscode.workspace.onDidChangeTextDocument(e => {
  console.log('Changed:', e.document.fileName);
});

vscode.workspace.onDidSaveTextDocument(doc => {
  console.log('Saved:', doc.fileName);
});
```

### Text Editor API

```typescript
const editor = vscode.window.activeTextEditor;
if (!editor) return;

// Get document and selection
const document = editor.document;
const selection = editor.selection;
const text = document.getText(selection);

// Edit document
await editor.edit(editBuilder => {
  // Insert text
  editBuilder.insert(new vscode.Position(0, 0), 'Header\n');

  // Replace text
  editBuilder.replace(selection, 'New text');

  // Delete text
  const line = document.lineAt(5);
  editBuilder.delete(line.range);
});

// Apply workspace edit (multiple files)
const edit = new vscode.WorkspaceEdit();
edit.insert(
  document.uri,
  new vscode.Position(0, 0),
  'New line\n'
);
await vscode.workspace.applyEdit(edit);

// Change selection
editor.selection = new vscode.Selection(
  new vscode.Position(0, 0),
  new vscode.Position(0, 10)
);

// Change visible range
editor.revealRange(
  new vscode.Range(10, 0, 20, 0),
  vscode.TextEditorRevealType.InCenter
);

// Add decorations
const decorationType = vscode.window.createTextEditorDecorationType({
  backgroundColor: 'rgba(255, 0, 0, 0.3)',
  border: '1px solid red'
});

const ranges = [new vscode.Range(0, 0, 0, 10)];
editor.setDecorations(decorationType, ranges);
```

### Language Features

```typescript
// Register completion provider
vscode.languages.registerCompletionItemProvider(
  { scheme: 'file', language: 'javascript' },
  {
    provideCompletionItems(document, position) {
      const item = new vscode.CompletionItem('myFunction');
      item.kind = vscode.CompletionItemKind.Function;
      item.detail = 'My custom function';
      item.documentation = 'This is my function';
      return [item];
    }
  },
  '.' // Trigger character
);

// Register hover provider
vscode.languages.registerHoverProvider('javascript', {
  provideHover(document, position) {
    const range = document.getWordRangeAtPosition(position);
    const word = document.getText(range);

    return new vscode.Hover(`Information about **${word}**`);
  }
});

// Register definition provider
vscode.languages.registerDefinitionProvider('javascript', {
  provideDefinition(document, position) {
    // Return location of definition
    return new vscode.Location(
      vscode.Uri.file('/path/to/definition.js'),
      new vscode.Position(10, 5)
    );
  }
});

// Register code action provider
vscode.languages.registerCodeActionsProvider('javascript', {
  provideCodeActions(document, range) {
    const fix = new vscode.CodeAction(
      'Fix issue',
      vscode.CodeActionKind.QuickFix
    );
    fix.edit = new vscode.WorkspaceEdit();
    fix.edit.replace(document.uri, range, 'fixed text');

    return [fix];
  }
});

// Register diagnostics
const diagnostics = vscode.languages.createDiagnosticCollection('myext');

function updateDiagnostics(document: vscode.TextDocument) {
  const diag = new vscode.Diagnostic(
    new vscode.Range(0, 0, 0, 10),
    'This is an error',
    vscode.DiagnosticSeverity.Error
  );
  diagnostics.set(document.uri, [diag]);
}
```

### Webviews

```typescript
// Create webview panel
const panel = vscode.window.createWebviewPanel(
  'myWebview',
  'My Webview',
  vscode.ViewColumn.One,
  {
    enableScripts: true,
    retainContextWhenHidden: true
  }
);

// Set HTML content
panel.webview.html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <style>
    body { padding: 20px; }
  </style>
</head>
<body>
  <h1>Hello from Webview!</h1>
  <button id="btn">Click me</button>

  <script>
    const vscode = acquireVsCodeApi();

    document.getElementById('btn').addEventListener('click', () => {
      vscode.postMessage({ command: 'clicked' });
    });
  </script>
</body>
</html>
`;

// Handle messages from webview
panel.webview.onDidReceiveMessage(message => {
  if (message.command === 'clicked') {
    vscode.window.showInformationMessage('Button clicked!');
  }
});

// Send message to webview
panel.webview.postMessage({ command: 'update', text: 'New data' });
```

## Testing Extensions

### Setup with @vscode/test-cli

```bash
npm install --save-dev @vscode/test-cli @vscode/test-electron
```

Add to `package.json`:

```json
{
  "scripts": {
    "test": "vscode-test"
  }
}
```

Create `.vscode-test.js`:

```javascript
const { defineConfig } = require('@vscode/test-cli');

module.exports = defineConfig({
  files: 'out/test/**/*.test.js',
  version: 'stable',
  workspaceFolder: './test-workspace',
  mocha: {
    ui: 'tdd',
    timeout: 20000
  }
});
```

### Writing Tests

```typescript
import * as assert from 'assert';
import * as vscode from 'vscode';

suite('Extension Test Suite', () => {
  vscode.window.showInformationMessage('Start all tests.');

  test('Sample test', () => {
    assert.strictEqual(-1, [1, 2, 3].indexOf(5));
    assert.strictEqual(-1, [1, 2, 3].indexOf(0));
  });

  test('Command registration', async () => {
    const commands = await vscode.commands.getCommands(true);
    assert.ok(commands.includes('my-extension.helloWorld'));
  });

  test('Configuration', () => {
    const config = vscode.workspace.getConfiguration('myExtension');
    assert.strictEqual(config.get('enable'), true);
  });
});
```

Run tests:

```bash
npm test
```

## Publishing Extensions

### 1. Create a Publisher

1. Go to [Visual Studio Marketplace publisher management](https://marketplace.visualstudio.com/manage)
2. Sign in with Microsoft account
3. Create a new publisher with unique ID
4. Note your publisher ID

### 2. Install vsce

```bash
npm install -g @vscode/vsce
```

### 3. Create Personal Access Token

1. Go to [Azure DevOps](https://dev.azure.com)
2. Create organization if needed
3. User Settings → Personal Access Tokens → New Token
4. Set organization to "All accessible organizations"
5. Set scope to "Marketplace (Manage)"
6. Copy the token

### 4. Login with vsce

```bash
vsce login <publisher-id>
# Enter your Personal Access Token when prompted
```

### 5. Package Extension

```bash
# Create .vsix file
vsce package

# Or specify version
vsce package 1.0.0
```

### 6. Publish Extension

```bash
# Publish directly
vsce publish

# Or publish with version bump
vsce publish minor  # 1.0.0 -> 1.1.0
vsce publish major  # 1.0.0 -> 2.0.0
vsce publish patch  # 1.0.0 -> 1.0.1

# Publish pre-release
vsce publish --pre-release
```

### 7. Update package.json

Ensure your `package.json` is complete:

```json
{
  "name": "my-extension",
  "displayName": "My Extension",
  "description": "A detailed description of my extension",
  "version": "1.0.0",
  "publisher": "my-publisher",
  "author": "Your Name",
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "https://github.com/username/repo.git"
  },
  "bugs": {
    "url": "https://github.com/username/repo/issues"
  },
  "homepage": "https://github.com/username/repo#readme",
  "keywords": ["keyword1", "keyword2"],
  "categories": ["Other"],
  "icon": "images/icon.png",
  "galleryBanner": {
    "color": "#C80000",
    "theme": "dark"
  },
  "engines": {
    "vscode": "^1.74.0"
  }
}
```

Add a comprehensive `README.md` and `CHANGELOG.md`.

## Best Practices

### Performance

1. **Lazy Activation**: Use specific activation events, avoid `"*"`
2. **Async Operations**: Use async/await for I/O operations
3. **Debounce Events**: Throttle expensive event handlers
4. **Virtual Documents**: Use virtual documents for generated content
5. **Lazy Loading**: Require heavy modules only when needed

```typescript
// Bad: Load on startup
import * as heavyModule from 'heavy-module';

// Good: Load when needed
let heavyModule: any;
async function useHeavyModule() {
  if (!heavyModule) {
    heavyModule = await import('heavy-module');
  }
  return heavyModule;
}
```

### Error Handling

```typescript
try {
  await riskyOperation();
} catch (error) {
  vscode.window.showErrorMessage(
    `Operation failed: ${error instanceof Error ? error.message : 'Unknown error'}`
  );
  console.error('Detailed error:', error);
}
```

### Disposables

Always dispose of resources:

```typescript
function activate(context: vscode.ExtensionContext) {
  // Register disposables
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(editor => {
      // Handle editor change
    }),

    vscode.workspace.onDidSaveTextDocument(document => {
      // Handle save
    }),

    vscode.commands.registerCommand('cmd', () => {
      // Handle command
    })
  );

  // Or manually dispose
  const disposable = vscode.workspace.createFileSystemWatcher('**/*.ts');
  context.subscriptions.push(disposable);
}
```

### Configuration Scope

```typescript
// Get configuration for specific resource
const docConfig = vscode.workspace.getConfiguration(
  'myExtension',
  document.uri
);

// Respect workspace vs user settings
const target = vscode.ConfigurationTarget.Workspace;
await config.update('setting', value, target);
```

### Output Channels

```typescript
const outputChannel = vscode.window.createOutputChannel('My Extension');
context.subscriptions.push(outputChannel);

outputChannel.appendLine('Extension activated');
outputChannel.show(); // Show output panel
```

### Context Keys

Set context keys for `when` clauses:

```typescript
// Set context key
vscode.commands.executeCommand(
  'setContext',
  'myExtension.isEnabled',
  true
);

// Use in package.json
{
  "commands": [{
    "command": "myExt.cmd",
    "title": "My Command",
    "enablement": "myExtension.isEnabled"
  }]
}
```

### Multi-root Workspace Support

```typescript
// Get workspace folder for a resource
const folder = vscode.workspace.getWorkspaceFolder(document.uri);

// Handle all workspace folders
vscode.workspace.workspaceFolders?.forEach(folder => {
  console.log('Folder:', folder.uri.fsPath);
});
```

## Common Patterns

### State Management

```typescript
// Global state (persisted across sessions)
await context.globalState.update('key', 'value');
const value = context.globalState.get('key');

// Workspace state (per workspace)
await context.workspaceState.update('key', 'value');
const value = context.workspaceState.get('key');

// Secrets (for passwords, tokens)
await context.secrets.store('apiKey', 'secret-value');
const secret = await context.secrets.get('apiKey');
```

### Extension Storage

```typescript
// Global storage path (roaming)
const globalStoragePath = context.globalStorageUri.fsPath;

// Workspace storage path (local to workspace)
const workspaceStoragePath = context.storageUri?.fsPath;

// Extension path (read-only, your extension files)
const extensionPath = context.extensionPath;
```

### Status Bar Items

```typescript
const statusBarItem = vscode.window.createStatusBarItem(
  vscode.StatusBarAlignment.Right,
  100 // priority
);

statusBarItem.text = '$(sync~spin) Loading...';
statusBarItem.tooltip = 'My extension is working';
statusBarItem.command = 'myExtension.showStatus';
statusBarItem.show();

context.subscriptions.push(statusBarItem);
```

### Terminal Integration

```typescript
// Create terminal
const terminal = vscode.window.createTerminal('My Terminal');
terminal.show();
terminal.sendText('echo Hello World');

// Listen for terminal events
vscode.window.onDidOpenTerminal(terminal => {
  console.log('Terminal opened:', terminal.name);
});

vscode.window.onDidCloseTerminal(terminal => {
  console.log('Terminal closed:', terminal.name);
});
```

## Language Server Protocol (LSP)

For advanced language features, consider using the Language Server Protocol:

```typescript
import {
  LanguageClient,
  LanguageClientOptions,
  ServerOptions,
  TransportKind
} from 'vscode-languageclient/node';

const serverModule = context.asAbsolutePath('out/server.js');
const serverOptions: ServerOptions = {
  run: { module: serverModule, transport: TransportKind.ipc },
  debug: { module: serverModule, transport: TransportKind.ipc }
};

const clientOptions: LanguageClientOptions = {
  documentSelector: [{ scheme: 'file', language: 'mylang' }]
};

const client = new LanguageClient(
  'myLangServer',
  'My Language Server',
  serverOptions,
  clientOptions
);

client.start();
```

## Resources

### Official Documentation
- **VS Code API**: https://code.visualstudio.com/api
- **Extension Samples and Codebases**: https://github.com/microsoft/vscode-extension-samples
- **Localization Basics and Sample**: https://github.com/microsoft/vscode-extension-samples/tree/main/l10n-sample
- **API Reference**: https://code.visualstudio.com/api/references/vscode-api
- **Contribution Points**: https://code.visualstudio.com/api/references/contribution-points
- **Activation Events**: https://code.visualstudio.com/api/references/activation-events
- **Extension Guidelines**: https://code.visualstudio.com/api/references/extension-guidelines

### Tools
- **Extension Generator**: `yo code`
- **Publishing Tool**: `@vscode/vsce`
- **Testing Framework**: `@vscode/test-cli`
- **Language Server**: `vscode-languageclient`

### Community
- **Stack Overflow**: [vscode-extensions tag](https://stackoverflow.com/questions/tagged/vscode-extensions)
- **GitHub Discussions**: https://github.com/microsoft/vscode-discussions
- **VS Code Dev Slack**: https://vscode-dev-community.slack.com/

## Quick Reference

### Common Commands to Register

```typescript
// Open file
vscode.commands.executeCommand('vscode.open', uri);

// Open diff view
vscode.commands.executeCommand('vscode.diff', leftUri, rightUri, title);

// Show references
vscode.commands.executeCommand('editor.action.showReferences', uri, position, locations);

// Format document
vscode.commands.executeCommand('editor.action.formatDocument');

// Set context
vscode.commands.executeCommand('setContext', 'key', value);
```

### Icons (Codicons)

Use VS Code's built-in icons:

```json
{
  "icon": "$(star)",
  "icon": "$(folder)",
  "icon": "$(file)",
  "icon": "$(check)",
  "icon": "$(sync~spin)"
}
```

Full list: https://microsoft.github.io/vscode-codicons/dist/codicon.html

### When Clause Contexts

Common context keys:

- `editorFocus`: Editor has focus
- `editorTextFocus`: Editor text has focus
- `editorHasSelection`: Text is selected
- `editorLangId == javascript`: Language ID match
- `resourceExtname == .ts`: File extension match
- `view == myView`: Specific view visible
- `viewItem == myItem`: Tree item type
- `config.myExt.enabled`: Configuration value
- `myExt.contextKey`: Custom context key

Operators: `==`, `!=`, `&&`, `||`, `!`, `in`, `not in`, `=~` (regex)

---

This skill covers the essential concepts and patterns for VS Code extension development. For specific scenarios, refer to the official documentation and extension samples repository. Always test your extension thoroughly before publishing, and follow the UX Guidelines to ensure a great user experience.
