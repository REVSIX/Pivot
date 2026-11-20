// Generate an MSI directory/component map from a freshly staged application.
import {readdir,readFile,writeFile} from 'node:fs/promises'
import path from 'node:path'
import {createHash} from 'node:crypto'

const [root,dest]=process.argv.slice(2)
const {version}=JSON.parse(await readFile(path.join(root,'app','package.json'),'utf8'))
if(!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Expected a major.minor.patch installer version.')
const esc=s=>s.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')
const hash=s=>createHash('sha256').update(s.toLowerCase()).digest('hex')
const key=(kind,relative)=>kind+hash(relative).slice(0,24)
function guid(name) {
  const s=hash('pivot.desktop.win64/'+name)
  return [s.slice(0,8),s.slice(8,12),'5'+s.slice(13,16),'a'+s.slice(17,20),s.slice(20,32)].join('-')
}
const refs=[]
async function directory(relative='') {
  const entries=(await readdir(path.join(root,relative),{withFileTypes:true})).sort((a,b)=>a.name.localeCompare(b.name,'en'))
  const files=entries.filter(e=>e.isFile())
  let xml=''
  if(files.length) {
    const component=key('C',relative || 'root')
    refs.push(component)
    xml+='<Component Id="'+component+'" Guid="'+guid(relative)+'">\n'
    for(const f of files){
      const full=path.join(relative,f.name)
      xml+='<File Id="'+key('F',full)+'" Source="'+esc(path.join(root,full))+'" Name="'+esc(f.name)+'"/>\n'
    }
    xml+='<RegistryValue Root="HKCU" Key="Software\\Pivot\\Install" Name="'+component+'" Value="1" Type="integer" KeyPath="yes"/>\n</Component>\n'
  }
  for(const entry of entries.filter(e=>e.isDirectory())){
    const next=path.join(relative,entry.name)
    xml+='<Directory Id="'+key('D',next)+'" Name="'+esc(entry.name)+'">'+await directory(next)+'</Directory>\n'
  }
  return xml
}
const tree=await directory()
const wix=`<Wix xmlns="http://wixtoolset.org/schemas/v4/wxs">
<Package Name="Pivot Robotics IDE" Manufacturer="Pivot contributors" Version="${version}" Scope="perUser" UpgradeCode="92DA186D-D279-4110-9F57-6D0509769041">
<MajorUpgrade Schedule="afterInstallInitialize" DowngradeErrorMessage="A newer version of Pivot is installed."/>
<MediaTemplate EmbedCab="yes" CompressionLevel="mszip"/>
<Icon Id="PivotIcon" SourceFile="${esc(path.join(root,'pivot.ico'))}"/>
<Property Id="ARPPRODUCTICON" Value="PivotIcon"/>
<StandardDirectory Id="LocalAppDataFolder"><Directory Id="AppsDir" Name="Programs"><Directory Id="INSTALLFOLDER" Name="Pivot">${tree}</Directory></Directory></StandardDirectory>
<StandardDirectory Id="ProgramMenuFolder"><Directory Id="PivotMenu" Name="Pivot">
<Component Id="Shortcuts" Guid="C9B1F726-3E1E-4640-8F40-6E9E3D18676A">
<Shortcut Id="LaunchPivot" Name="Pivot" Target="[INSTALLFOLDER]Pivot.exe" WorkingDirectory="INSTALLFOLDER" Icon="PivotIcon"/>
<RemoveFolder Id="CleanPivotMenu" On="uninstall"/>
<RegistryValue Root="HKCU" Key="Software\\Pivot\\Install" Name="Shortcut" Value="1" Type="integer" KeyPath="yes"/>
</Component></Directory></StandardDirectory>
<Feature Id="Workbench" Title="Pivot" Level="1">${refs.map(id=>'<ComponentRef Id="'+id+'"/>').join('')}<ComponentRef Id="Shortcuts"/></Feature>
</Package></Wix>`
await writeFile(dest,wix)
