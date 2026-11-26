return {
	settings = {
		gopls = {
			gofumpt = true,
			staticcheck = true,
			usePlaceholders = true,
			hints = {
				parameterNames = true,
				assignVariableTypes = true,
				compositeLiteralFields = true,
			},
		},
	},
}
