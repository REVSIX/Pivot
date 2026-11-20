import type {Palette} from '../shared/theme.ts'
// The caller validates every palette value as a six-digit hex color.
export function themeExpression(p:Palette) {
  const colors:Record<string,[string,string]> = {
    Normal:[p.text,p.panel],NormalNC:[p.text,p.panel],NormalFloat:[p.text,p.surface],
    SignColumn:[p.muted,p.panel],LineNr:[p.muted,p.panel],CursorLineNr:[p.accent,p.surface],
    CursorLine:[p.text,p.surface],Visual:[p.text,p.sel],StatusLine:[p.text,p.sel],
    StatusLineNC:[p.muted,p.surface],WinSeparator:[p.line,p.panel],FloatBorder:[p.line,p.surface],
    Pmenu:[p.text,p.surface],PmenuSel:[p.text,p.sel],
  }
  const entries=Object.entries(colors).map(([group,[fg,bg]])=>group+'={fg="'+fg+'",bg="'+bg+'"}')
  const lua='lua local groups={'+entries.join(',')+'}; local function apply() for group,style in pairs(groups) do vim.api.nvim_set_hl(0,group,style) end end; apply(); vim.api.nvim_create_autocmd({"VimEnter","ColorScheme"},{group=vim.api.nvim_create_augroup("PivotTheme",{clear=true}),callback=apply})'
  return "execute('"+lua+"')"
}
