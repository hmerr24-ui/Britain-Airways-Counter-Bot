import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import fs from "node:fs";
const TOKEN=process.env.DISCORD_TOKEN, CLIENT_ID=process.env.CLIENT_ID, GUILD_ID=process.env.GUILD_ID;
if(!TOKEN||!CLIENT_ID||!GUILD_ID){console.error("Missing DISCORD_TOKEN, CLIENT_ID or GUILD_ID");process.exit(1);}
const client=new Client({intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers]});
const FILE="counters.json";
const TYPES={
 members:["Members","👥"], pilots:["Pilots","👨‍✈️"], flights:["Flights Completed","✈️"], verified:["Verified","🔗"],
 staff:["Staff","🛠️"], bots:["Bots","🤖"], humans:["Human Members","👤"], channels:["Channels","📁"],
 roles:["Roles","🎭"], voice:["Voice Members","🎙️"]
};
function load(){try{return JSON.parse(fs.readFileSync(FILE,"utf8"))}catch{return {counters:[]}}}
function save(d){fs.writeFileSync(FILE,JSON.stringify(d,null,2))}
function staff(i){return !!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)}
function menuEmbed(){return new EmbedBuilder().setTitle("📊 Britain Airways Counters").setDescription("Select the counters you want to create or keep, then press **Save**.")}
function menu(selected=[]){
 const select=new StringSelectMenuBuilder().setCustomId("counter_select").setPlaceholder("Choose counters").setMinValues(0).setMaxValues(Object.keys(TYPES).length).addOptions(Object.entries(TYPES).map(([k,[label,emoji]])=>({label,description:`Counter: ${label}`,value:k,emoji,default:selected.includes(k)})));
 return [new ActionRowBuilder().addComponents(select),new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId("counter_save").setLabel("Save").setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId("counter_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary))];
}
async function value(g,type){
 if(type==="members")return g.memberCount;
 if(type==="bots")return g.members.cache.filter(m=>m.user.bot).size;
 if(type==="humans")return g.members.cache.filter(m=>!m.user.bot).size;
 if(type==="channels")return g.channels.cache.size;
 if(type==="roles")return g.roles.cache.size;
 if(type==="staff")return g.members.cache.filter(m=>m.permissions.has(PermissionFlagsBits.ManageGuild)&&!m.user.bot).size;
 if(type==="voice")return g.channels.cache.filter(c=>c.type===ChannelType.GuildVoice||c.type===ChannelType.GuildStageVoice).reduce((n,c)=>n+c.members.size,0);
 if(type==="verified"){const r=g.roles.cache.find(r=>r.name.toLowerCase()==="verified");return r?r.members.size:0;}
 if(type==="pilots"||type==="flights")return 0;
 return 0;
}
async function refresh(g){
 const d=load();
 for(const c of d.counters){try{const ch=await g.channels.fetch(c.channelId);if(ch){const [label,emoji]=TYPES[c.type];await ch.setName(`${emoji} ${label}: ${await value(g,c.type)}`)}}catch{}}
}
async function create(g,types){
 const d=load();
 for(const c of [...d.counters])if(!types.includes(c.type)){try{const ch=await g.channels.fetch(c.channelId);if(ch)await ch.delete()}catch{}}
 d.counters=d.counters.filter(c=>types.includes(c.type));
 for(const type of types)if(!d.counters.some(c=>c.type===type)){
  const [label,emoji]=TYPES[type];
  const ch=await g.channels.create({name:`${emoji} ${label}: 0`,type:ChannelType.GuildVoice,permissionOverwrites:[{id:g.roles.everyone.id,deny:[PermissionFlagsBits.Connect]}]});
  d.counters.push({type,channelId:ch.id});
 }
 save(d);await refresh(g);
}
const commands=[new SlashCommandBuilder().setName("counter").setDescription("Manage Britain Airways counters.")
 .addSubcommand(s=>s.setName("create").setDescription("Choose and create counters."))
 .addSubcommand(s=>s.setName("edit").setDescription("Choose which counters exist."))
 .addSubcommand(s=>s.setName("refresh").setDescription("Refresh counter values."))
 .addSubcommand(s=>s.setName("delete").setDescription("Delete all counter channels."))
].map(c=>c.toJSON());
client.once("ready",async()=>{const rest=new REST({version:"10"}).setToken(TOKEN);await rest.put(Routes.applicationGuildCommands(CLIENT_ID,GUILD_ID),{body:commands});const g=await client.guilds.fetch(GUILD_ID);await g.members.fetch();await refresh(g);console.log(`Logged in as ${client.user.tag}`);});
client.on("interactionCreate",async i=>{
 try{
  if(i.isChatInputCommand()&&i.commandName==="counter"){
   if(!staff(i))return i.reply({content:"🔒 Staff only.",ephemeral:true});
   const sub=i.options.getSubcommand(),d=load();
   if(sub==="create"||sub==="edit")return i.reply({embeds:[menuEmbed()],components:menu(sub==="edit"?d.counters.map(c=>c.type):[]),ephemeral:true});
   await i.deferReply({ephemeral:true});
   if(sub==="refresh"){await refresh(i.guild);return i.editReply("✅ Counters refreshed.");}
   if(sub==="delete"){await create(i.guild,[]);return i.editReply("🗑️ All counter channels deleted.");}
  }
  if(i.isStringSelectMenu()&&i.customId==="counter_select"){
   return i.update({embeds:[menuEmbed()],components:[
    new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId(`counter_selected:${i.values.join(",")}`).setPlaceholder(`${i.values.length} selected`).setMinValues(0).setMaxValues(Object.keys(TYPES).length).addOptions(Object.entries(TYPES).map(([k,[label,emoji]])=>({label,description:`Counter: ${label}`,value:k,emoji,default:i.values.includes(k)})))),
    new ActionRowBuilder().addComponents(new ButtonBuilder().setCustomId(`counter_save:${i.values.join(",")}`).setLabel("Save").setStyle(ButtonStyle.Success),new ButtonBuilder().setCustomId("counter_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary))
   ]});
  }
  if(i.isButton()&&i.customId.startsWith("counter_save")){
   const types=i.customId.slice("counter_save:".length).split(",").filter(Boolean);
   await i.deferUpdate();await create(i.guild,types);return i.editReply({content:`✅ Created/updated **${types.length}** counter(s).`,embeds:[],components:[]});
  }
  if(i.isButton()&&i.customId==="counter_cancel")return i.update({content:"❌ Cancelled.",embeds:[],components:[]});
 }catch(e){console.error(e);try{if(i.replied||i.deferred)await i.editReply("❌ Something went wrong. Check Railway logs.");else await i.reply({content:"❌ Something went wrong. Check Railway logs.",ephemeral:true})}catch{}}
});
client.login(TOKEN);
