import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, PermissionFlagsBits, ChannelType, ActionRowBuilder, StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder } from "discord.js";
import fs from "node:fs";

const { DISCORD_TOKEN, CLIENT_ID, GUILD_ID } = process.env;
if (!DISCORD_TOKEN || !CLIENT_ID || !GUILD_ID) process.exit(1);

const client = new Client({ intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers] });
const FILE = "./counters.json";

const TYPES = {
  members:["Members","👥"], pilots:["Pilots","👨‍✈️"], flights:["Flights Completed","✈️"],
  verified:["Verified","🔗"], staff:["Staff","🛠️"], bots:["Bots","🤖"],
  humans:["Human Members","👤"], channels:["Channels","📁"], roles:["Roles","🎭"], voice:["Voice Members","🎙️"]
};

const load=()=>{try{return JSON.parse(fs.readFileSync(FILE,"utf8"))}catch{return {counters:[]}}};
const save=d=>fs.writeFileSync(FILE,JSON.stringify(d,null,2));
const isStaff=i=>!!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild);

function panel(selected=[]){
  const menu=new StringSelectMenuBuilder().setCustomId("counter_select").setPlaceholder("Choose counters").setMinValues(1).setMaxValues(Object.keys(TYPES).length)
    .addOptions(Object.entries(TYPES).map(([v,[label,emoji]])=>({label,description:`Counter: ${label}`,value:v,emoji,default:selected.includes(v)})));
  return [new ActionRowBuilder().addComponents(menu),new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId("counter_save").setLabel("Create / Save").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId("counter_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
  )];
}
const embed=new EmbedBuilder().setTitle("📊 Britain Airways Counters").setDescription("Select the counters you want, then press **Create / Save**.");

async function value(g,type){
  if(type==="members") return g.memberCount;
  if(type==="bots") return g.members.cache.filter(m=>m.user.bot).size;
  if(type==="humans") return g.members.cache.filter(m=>!m.user.bot).size;
  if(type==="channels") return g.channels.cache.size;
  if(type==="roles") return g.roles.cache.size;
  if(type==="staff") return g.members.cache.filter(m=>!m.user.bot&&m.permissions.has(PermissionFlagsBits.ManageGuild)).size;
  if(type==="voice") return g.channels.cache.filter(c=>c.type===ChannelType.GuildVoice||c.type===ChannelType.GuildStageVoice).reduce((n,c)=>n+c.members.size,0);
  if(type==="verified"){const r=g.roles.cache.find(r=>r.name.toLowerCase()==="verified");return r?.members.size||0;}
  return 0;
}
async function refresh(g){
  const d=load();
  for(const c of d.counters) try{
    const ch=await g.channels.fetch(c.channelId); if(!ch) continue;
    const [label,emoji]=TYPES[c.type], n=await value(g,c.type);
    await ch.setName(`${emoji} ${label}: ${n}`);
  }catch(e){console.error("Refresh:",e.message)}
}
async function apply(g,types){
  const d=load(), wanted=new Set(types);
  for(const c of d.counters) if(!wanted.has(c.type)) try{const ch=await g.channels.fetch(c.channelId);if(ch)await ch.delete()}catch{}
  d.counters=d.counters.filter(c=>wanted.has(c.type));
  for(const type of types) if(!d.counters.some(c=>c.type===type)){
    const [label,emoji]=TYPES[type];
    const ch=await g.channels.create({name:`${emoji} ${label}: 0`,type:ChannelType.GuildVoice,
      permissionOverwrites:[{id:g.roles.everyone.id,deny:[PermissionFlagsBits.Connect,PermissionFlagsBits.Speak]}]});
    d.counters.push({type,channelId:ch.id});
  }
  save(d); await refresh(g);
}

const commands=[new SlashCommandBuilder().setName("counter").setDescription("Manage Britain Airways counters.")
  .addSubcommand(s=>s.setName("create").setDescription("Choose counters to create."))
  .addSubcommand(s=>s.setName("edit").setDescription("Choose which counters exist."))
  .addSubcommand(s=>s.setName("refresh").setDescription("Refresh counter values."))
  .addSubcommand(s=>s.setName("delete").setDescription("Delete all counter channels."))
].map(c=>c.toJSON());

client.once("ready",async()=>{
  const rest=new REST({version:"10"}).setToken(DISCORD_TOKEN);
  await rest.put(Routes.applicationGuildCommands(CLIENT_ID,GUILD_ID),{body:commands});
  const g=await client.guilds.fetch(GUILD_ID); await g.members.fetch(); await refresh(g);
  console.log(`Logged in as ${client.user.tag}`); console.log("Counter Bot ready.");
});
client.on("interactionCreate",async i=>{
 try{
  if(i.isChatInputCommand()&&i.commandName==="counter"){
    if(!isStaff(i)) return i.reply({content:"🔒 Staff only.",ephemeral:true});
    const sub=i.options.getSubcommand(), d=load();
    if(sub==="create"||sub==="edit") return i.reply({embeds:[embed],components:panel(sub==="edit"?d.counters.map(c=>c.type):[]),ephemeral:true});
    if(sub==="refresh"){await i.deferReply({ephemeral:true});await refresh(i.guild);return i.editReply("✅ Counters refreshed.")}
    if(sub==="delete"){await i.deferReply({ephemeral:true});await apply(i.guild,[]);return i.editReply("🗑️ All counter channels deleted.")}
  }
  if(i.isStringSelectMenu()&&i.customId==="counter_select"){
    const s=i.values;
    return i.update({embeds:[embed],components:[new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId(`counter_selected:${s.join(",")}`).setPlaceholder(`${s.length} selected`).setMinValues(1).setMaxValues(Object.keys(TYPES).length)
      .addOptions(Object.entries(TYPES).map(([v,[label,emoji]])=>({label,description:`Counter: ${label}`,value:v,emoji,default:s.includes(v)})))
    ),new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`counter_save:${s.join(",")}`).setLabel("Create / Save").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("counter_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
    )]});
  }
  if(i.isButton()&&i.customId.startsWith("counter_save:")){
    if(!isStaff(i)) return i.reply({content:"🔒 Staff only.",ephemeral:true});
    const s=i.customId.slice(14).split(",").filter(Boolean); await i.deferUpdate(); await apply(i.guild,s);
    return i.editReply({content:`✅ Counter setup saved — **${s.length}** selected.`,embeds:[],components:[]});
  }
  if(i.isButton()&&i.customId==="counter_cancel") return i.update({content:"❌ Cancelled.",embeds:[],components:[]});
 }catch(e){console.error("Interaction:",e);try{if(i.replied||i.deferred)await i.editReply("❌ Something went wrong. Check Railway logs.");else await i.reply({content:"❌ Something went wrong. Check Railway logs.",ephemeral:true})}catch{}}
});
client.login(DISCORD_TOKEN);
