const path = require("path");
const webpack = require("webpack");
const CopyWebpackPlugin = require("copy-webpack-plugin");

const config = {
  entry: "./src/extension.ts",
  devtool: "source-map",
  externals: {
    vscode: "commonjs vscode"
  },
  resolve: {
    fallback: {
      os: require.resolve("os-browserify/browser"),
      path: require.resolve("path-browserify"),
      util: require.resolve("util/")
    },
    extensions: [".ts", ".js", ".json"]
  },
  node: {
    __filename: false,
    __dirname: false
  },
  module: {
    rules: [
      {
        test: /\.ts$/,
        exclude: /node_modules/,
        use: [
          {
            loader: "ts-loader"
          }
        ]
      }
    ]
  },
  plugins: [
    new webpack.SourceMapDevToolPlugin({
      test: /\.ts$/,
      noSources: false,
      module: true,
      columns: true
    }),
    new CopyWebpackPlugin({
      patterns: [
        {
          from: path.resolve(__dirname, 'src/audio/assets/player.css'),
          to: 'assets/player.css'
        }
      ]
    })
  ]
};

const nodeConfig = {
  ...config,
  target: 'node',
  externals: {
    vscode: "commonjs vscode",
    // Node.js built-ins should be external in Node.js environment
    fs: "commonjs fs",
    path: "commonjs path",
    child_process: "commonjs child_process"
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension-node.js',
    libraryTarget: "commonjs2",
    devtoolModuleFilenameTemplate: "../[resource-path]",
  },
  resolve: {
    ...config.resolve,
    fallback: {
      // No fallbacks needed for Node.js environment
    }
  }
};

const webConfig = {
  ...config,
  target: 'webworker',
  externals: {
    vscode: "commonjs vscode"
  },
  resolve: {
    ...config.resolve,
    fallback: {
      os: require.resolve("os-browserify/browser"),
      path: require.resolve("path-browserify"),
      // Audio functionality requires Node.js - provide false for web build
      fs: false,
      child_process: false
    }
  },
  output: {
    path: path.resolve(__dirname, 'dist'),
    filename: 'extension-web.js',
    libraryTarget: "commonjs2",
    devtoolModuleFilenameTemplate: "../[resource-path]",
  }
};

module.exports = [nodeConfig, webConfig];