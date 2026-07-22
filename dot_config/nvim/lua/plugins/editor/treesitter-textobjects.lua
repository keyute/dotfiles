return {
	"nvim-treesitter/nvim-treesitter-textobjects",
	event = { "BufReadPost", "BufNewFile" },
	dependencies = { "nvim-treesitter/nvim-treesitter" },
	config = function()
		require("nvim-treesitter-textobjects").setup({
			select = {
				lookahead = true,
				selection_modes = {
					["@function.outer"] = "V",
					["@class.outer"] = "V",
				},
			},
			move = {
				set_jumps = true, -- record jumps in the jumplist for ]f/[f etc.
			},
		})

		local select = require("nvim-treesitter-textobjects.select").select_textobject
		local move = require("nvim-treesitter-textobjects.move")
		local swap = require("nvim-treesitter-textobjects.swap")

		-- Select: around/inner function, class, argument
		local selects = {
			["af"] = "@function.outer",
			["if"] = "@function.inner",
			["ac"] = "@class.outer",
			["ic"] = "@class.inner",
			["aa"] = "@parameter.outer",
			["ia"] = "@parameter.inner",
		}
		for lhs, obj in pairs(selects) do
			vim.keymap.set({ "x", "o" }, lhs, function()
				select(obj, "textobjects")
			end, { desc = "Select " .. obj })
		end

		-- Move between functions/classes (]c/[c left alone for diff navigation)
		vim.keymap.set({ "n", "x", "o" }, "]f", function()
			move.goto_next_start("@function.outer", "textobjects")
		end, { desc = "Next function start" })
		vim.keymap.set({ "n", "x", "o" }, "[f", function()
			move.goto_previous_start("@function.outer", "textobjects")
		end, { desc = "Prev function start" })
		vim.keymap.set({ "n", "x", "o" }, "]]", function()
			move.goto_next_start("@class.outer", "textobjects")
		end, { desc = "Next class start" })
		vim.keymap.set({ "n", "x", "o" }, "[[", function()
			move.goto_previous_start("@class.outer", "textobjects")
		end, { desc = "Prev class start" })

		-- Swap the argument under the cursor with the next/previous one
		vim.keymap.set("n", "<leader>a", function()
			swap.swap_next("@parameter.inner")
		end, { desc = "Swap parameter with next" })
		vim.keymap.set("n", "<leader>A", function()
			swap.swap_previous("@parameter.inner")
		end, { desc = "Swap parameter with previous" })
	end,
}
