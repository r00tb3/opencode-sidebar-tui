/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui"
import { setupSidebar } from "./sidebar/tui.tsx"
import { setupFooter } from "./footer/tui.tsx"

// Keep the original plugin id so existing sidebar settings keep the same store.
export default Plugin.define({
	id: "oc-sidebar.tui",
	setup(context) {
		setupSidebar(context)
		return setupFooter(context)
	},
})
