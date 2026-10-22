module("luci.controller.tasks", package.seeall)

local fs = require "nixio.fs"
local http = require "luci.http"
local jsonc = require "luci.jsonc"
local util = require "luci.util"

local function valid_id(id)
	return id ~= nil and #id <= 64 and
		id:match("^[%w][%w_.%-]*$") ~= nil
end

function index()
	entry({"admin", "system", "tasks"},
		alias("admin", "system", "tasks", "status"), nil, 60)
	entry({"admin", "system", "tasks", "status"}, call("action_status"))
	entry({"admin", "system", "tasks", "log"}, call("action_log"))
	entry({"admin", "system", "tasks", "stop"}, call("action_stop"))
end

function action_status()
	local task_id = http.formvalue("task_id") or ""
	if task_id ~= "" and not valid_id(task_id) then
		http.status(400, "Bad Request")
		return
	end

	local taskd = require "luci.model.tasks"
	http.prepare_content("application/json")
	http.write(jsonc.stringify(taskd.status(task_id)))
end

function action_log()
	local task_id = http.formvalue("task_id") or ""
	if not valid_id(task_id) then
		http.status(404, "Not Found")
		return
	end

	local offset = tonumber(http.formvalue("offset") or "0") or 0
	local path = "/var/log/tasks/" .. task_id .. ".log"
	local size = fs.stat(path, "size") or 0

	if offset > size then
		http.status(205, "Reset Content")
		return
	end
	if offset >= size then
		http.status(204, "No Content")
		return
	end

	local file = io.open(path, "rb")
	if not file then
		http.status(404, "Not Found")
		return
	end
	file:seek("set", offset)
	local chunk = file:read(size - offset)
	file:close()

	http.prepare_content("application/octet-stream")
	http.write(chunk or "")
end

function action_stop()
	local task_id = http.formvalue("task_id") or ""
	if valid_id(task_id) then
		os.execute("/etc/init.d/tasks task_del " ..
			util.shellquote(task_id) .. " >/dev/null 2>&1")
	end

	http.prepare_content("text/plain")
	http.write("ok")
end
