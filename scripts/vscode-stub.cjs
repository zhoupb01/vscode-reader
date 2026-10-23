// 供脚本在 VS Code 之外运行时的 vscode 模块桩（stub）
module.exports = {
    workspace: {
        getConfiguration: () => ({ get: () => "" })
    },
    window: {},
    commands: {},
    languages: {}
};
