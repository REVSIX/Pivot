export const themes = {
  tokyo: {
    bg:'#141520', panel:'#191a29', surface:'#202131', sel:'#33344a', line:'#36384c', grid:'#2d2e43',
    text:'#dedff0', muted:'#969bb6', accent:'#f4c968', 'accent-surface':'#352e23',
    'trace-a':'#c6a0f6','trace-b':'#86dce1', green:'#98d99c', danger:'#f1899d',
  },
  nord: {
    bg:'#202937', panel:'#253041', surface:'#2b384b', sel:'#3b4b64', line:'#44536a', grid:'#354359',
    text:'#e5eaf2', muted:'#b0bacb', accent:'#ebcb8b', 'accent-surface':'#3d3d39',
    'trace-a':'#b9a4d5','trace-b':'#88c0d0',green:'#a3be8c',danger:'#bf616a',
  },
  gruvbox: {
    bg:'#23201e', panel:'#292521',surface:'#312c26',sel:'#483d32',line:'#50453a',grid:'#3b342d',
    text:'#eee0c6',muted:'#bba998',accent:'#fabd2f','accent-surface':'#473922',
    'trace-a':'#d699b6','trace-b':'#8ec07c',green:'#b8bb26',danger:'#fb4934',
  },
  rose: {
    bg:'#191724',panel:'#211f30',surface:'#28263a',sel:'#403852',line:'#413c53',grid:'#343044',
    text:'#e0def4',muted:'#a49db6',accent:'#f6c177','accent-surface':'#39302e',
    'trace-a':'#c4a7e7','trace-b':'#9ccfd8',green:'#a6daab',danger:'#eb6f92',
  },
} as const
export type ThemeName=keyof typeof themes
export type Palette=Record<keyof typeof themes.tokyo,string>
export function isTheme(name:unknown):name is ThemeName {
  return typeof name==='string' && Object.hasOwn(themes,name)
}
export function isPalette(value:unknown):value is Palette {
  if(!value||typeof value!=='object')return false
  const colors=value as Record<string,unknown>
  return Object.keys(colors).length===Object.keys(themes.tokyo).length&&Object.keys(themes.tokyo).every(key=>
    Object.hasOwn(colors,key)&&typeof colors[key]==='string'&&/^#[0-9a-f]{6}$/i.test(colors[key]))
}
