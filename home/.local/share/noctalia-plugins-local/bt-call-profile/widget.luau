--!nonstrict
-- Text indicator of the active BT audio profile. Left click toggles music <-> call.

local MODE_KEY = "bt_call_profile_mode"

local mode = noctalia.state.get(MODE_KEY) or "unknown"

local function render()
	if mode == "headset-head-unit" then
		barWidget.setText("CALL")
		barWidget.setGlyphColor("primary")
		barWidget.setTooltip({
			{ key = "Profile", value = "Call (HFP)" },
			{ key = "Click", value = "Switch to music (A2DP)" },
		})
	elseif mode == "a2dp-sink" then
		barWidget.setText("A2DP")
		barWidget.setGlyphColor("default")
		barWidget.setTooltip({
			{ key = "Profile", value = "Music (A2DP)" },
			{ key = "Click", value = "Switch to call (HFP)" },
		})
	elseif mode == "no-card" then
		barWidget.setText("BT-")
		barWidget.setGlyphColor("disabled")
		barWidget.setTooltip({ { key = "Headset", value = "disconnected" } })
	else
		barWidget.setText("BT?")
		barWidget.setGlyphColor("disabled")
		barWidget.setTooltip({ { key = "Profile", value = mode } })
	end
end

noctalia.state.watch(MODE_KEY, function(value)
	mode = value or "unknown"
	render()
end)

render()
