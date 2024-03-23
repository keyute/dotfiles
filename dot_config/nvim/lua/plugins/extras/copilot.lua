return {
  "CopilotC-Nvim/CopilotChat.nvim",
  dependencies = {
    "zbirenbaum/copilot.lua",
    "nvim-lua/plenary.nvim"
  },
  opts = {},
  keys = {
    { "<leader>cc", "<cmd>CopilotChatToggle<cr>",   desc = "Toggle Copilot Chat" },
    { "<leader>ce", "<cmd>CopilotChatExplain<cr>",  desc = "Copilot Explain Code" },
    { "<leader>ct", "<cmd>CopilotChatTests<cr>",    desc = "Copilot Generate Tests" },
    { "<leader>cf", "<cmd>CopilotChatFix<cr>",      desc = "Copilot Fix Code" },
    { "<leader>co", "<cmd>CopilotChatOptimize<cr>", desc = "Copilot Optimize Code" },
    { "<leader>cd", "<cmd>CopilotChatDocs<cr>",     desc = "Copilot Generate Docs" }
  }
}
