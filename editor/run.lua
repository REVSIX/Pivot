function _G.PivotRunFile()
  local file = vim.api.nvim_buf_get_name(0)
  if vim.bo.buftype ~= "" or vim.fn.filereadable(file) ~= 1 then
    return vim.json.encode({ error = "Open and save a runnable file first." })
  end
  if vim.bo.modified then
    return vim.json.encode({ error = "Save the current buffer (:w) and run again." })
  end
  return vim.json.encode({ file = file })
end

local function move_buffer(buffer, target)
  local loaded = vim.api.nvim_buf_is_loaded(buffer)
  local modified = vim.bo[buffer].modified
  local draft = modified and vim.api.nvim_buf_get_lines(buffer, 0, -1, false)
  vim.api.nvim_buf_set_name(buffer, target)
  if not loaded then
    return
  end

  -- Re-read the renamed file so Neovim recognizes it as the buffer's original
  -- file on the next :write. Keep the draft and undo history across that read.
  return vim.api.nvim_buf_call(buffer, function()
    local view = vim.fn.winsaveview()
    local undo_file = vim.fn.tempname()
    local undo = vim.fn.fnameescape(undo_file)
    local saved_undo = pcall(vim.cmd, "silent wundo! " .. undo)
    local ok, err = pcall(vim.cmd, "silent keepalt keepjumps edit!")
    if draft then
      vim.api.nvim_buf_set_lines(buffer, 0, -1, false, draft)
      vim.bo[buffer].modified = true
    end
    if saved_undo then
      pcall(vim.cmd, "silent rundo " .. undo)
    end
    vim.fn.delete(undo_file)
    vim.fn.winrestview(view)
    if not ok then
      error(err)
    end
  end)
end

function _G.PivotMoveBuffers(paths)
  local source, destination = vim.fs.normalize(paths[1]), vim.fs.normalize(paths[2])
  local function casefold(path)
    return vim.fn.has("win32") == 1 and path:lower() or path
  end
  local source_key = casefold(source)
  local conflict = false
  for _, buffer in ipairs(vim.api.nvim_list_bufs()) do
    local name = vim.api.nvim_buf_get_name(buffer)
    if name ~= "" and vim.bo[buffer].buftype == "" then
      local normalized = vim.fs.normalize(name)
      local key = casefold(normalized)
      if key == source_key or key:sub(1, #source_key + 1) == source_key .. "/" then
        local target = destination .. normalized:sub(#source + 1)
        if not pcall(move_buffer, buffer, target) then
          conflict = true
        end
      end
    end
  end
  return conflict and "A moved buffer could not be reopened. Check its name and save the draft in Neovim." or ""
end
