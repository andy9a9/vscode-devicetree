# DeviceTree Language Support for Visual Studio Code

More than just a syntax highlighter for DeviceTree files in VSCode.


## Features

### Syntax Highlighting

This extension provides comprehensive syntax highlighting for Device Tree Source (DTS) files, including:

- **Comments**: Line comments (`//`) and block comments (`/* */`)
- **Preprocessor directives**: `#include` statements with file paths
- **Node definitions**: Node names, labels, and addresses (`label: node@address { }`)
- **Properties**: Cell arrays (`<...>`) with references, numbers, and constants
- **Data types**:
  - Strings (`"compatible"`, `"okay"`, ...)
  - Numbers (decimal `100000`, ...)
  - Node references (`&pinctrl_set1`, `&pinctrl_set2`, ...)
  - Constants (`IMX8MP_CLK_IPP_DO_CLKO1`, `IMX8MP_SYS_PLL1_80M`, ...)

![Device Tree Syntax Highlighting](docs/images/highlighting.png)

*Example of Device Tree file with syntax highlighting enabled*


#### Supported File Extensions

- `.dts` - Device Tree Source files
- `.dtsi` - Device Tree Source Include files
- `.dtso` - Device Tree Source Overlays files

### Comamnds

It just prints `Hello World from DeviceTree!` for now


## How to Test the Extension

- Press `F5` to open a new window with your extension loaded


### Syntax Highlighting

- Open a `.dts`, `.dtsi` or `.dtso` file to see syntax highlighting in action
- The highlighting should automatically apply to Device Tree files


### Commands

- Run your command from the command palette by pressing (`Ctrl+Shift+P` or `Cmd+Shift+P` on Mac) and typing `Hello World`.
- Set breakpoints in your code inside src/extension.ts to debug your extension.
- Find output from your extension in the debug console.


## License

MIT
