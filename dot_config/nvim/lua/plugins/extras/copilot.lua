return {
  "CopilotC-Nvim/CopilotChat.nvim",
  dependencies = {
    "zbirenbaum/copilot.lua",
    "nvim-lua/plenary.nvim",
    "nvim-telescope/telescope.nvim"
  },
  config = function()
    local chat = require("CopilotChat")
    local select = require("CopilotChat.select")
    chat.setup({
      context = "buffers",
      selection = select.buffer
    })
  end,
  keys = {
    { "<leader>c", "<cmd>CopilotChatToggle<cr>", desc = "Toggle Copilot Chat" },
    {
      "<leader>fc",
      function()
        local actions = require("CopilotChat.actions")
        require("CopilotChat.integrations.telescope").pick(actions.prompt_actions())
      end,
      desc = "Copilot Prompt Actions"
    }
  }
}
