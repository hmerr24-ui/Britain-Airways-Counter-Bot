import {
  Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder,
  PermissionFlagsBits, ChannelType, ActionRowBuilder,
  StringSelectMenuBuilder, ButtonBuilder, ButtonStyle, EmbedBuilder,
  MessageFlags
} from "discord.js";
import fs from "node:fs";

const {DISCORD_TOKEN,CLIENT_ID,GUILD_ID,PILOT_ROLE_ID,VERIFIED_ROLE_ID}=process.env;
if(!DISCORD_TOKEN||!CLIENT_ID||!GUILD_ID){console.error("Missing DISCORD_TOKEN, CLIENT_ID or GUILD_ID.");process.exit(1);}

const client=new Client({
  intents:[GatewayIntentBits.Guilds,GatewayIntentBits.GuildMembers,GatewayIntentBits.GuildPresences]
});
const FILE="./counters.json";

const TYPES={
 members:{label:"Members",emoji:"👥",description:"Total server members"},
 pilots:{label:"Pilots",emoji:"👨‍✈️",description:"Members with the Pilot role"},
 flights:{label:"Flights Completed",emoji:"✈️",description:"Completed flights (Pilot Tracker connection later)"},
 verified:{label:"Verified",emoji:"🔗",description:"Members with the Verified role"},
 staff:{label:"Staff",emoji:"🛠️",description:"Members with Manage Server"},
 bots:{label:"Bots",emoji:"🤖",description:"Bots in the server"},
 humans:{label:"Human Members",emoji:"👤",description:"Non-bot members"},
 channels:{label:"Channels",emoji:"📁",description:"Total channels"},
 roles:{label:"Roles",emoji:"🎭",description:"Total roles"},
 voice:{label:"Voice Members",emoji:"🎙️",description:"Members currently in voice"}
};

function load(){try{return JSON.parse(fs.readFileSync(FILE,"utf8"))}catch{return{counters:[]}}}
function save(d){fs.writeFileSync(FILE,JSON.stringify(d,null,2))}
function staff(i){return !!i.memberPermissions?.has(PermissionFlagsBits.ManageGuild)}

function embed(){
  return new EmbedBuilder()
    .setTitle("📊 Britain Airways Counters")
    .setDescription("Select the counters you want and press **Create / Save**.")
    .setFooter({text:"Britain Airways Counter Bot"});
}

function components(selected=[]){
  const menu=new StringSelectMenuBuilder()
    .setCustomId("counter_select")
    .setPlaceholder("Choose counters")
    .setMinValues(1)
    .setMaxValues(Object.keys(TYPES).length)
    .addOptions(Object.entries(TYPES).map(([value,t])=>({
      label:t.label,description:t.description,value,emoji:t.emoji,default:selected.includes(value)
    })));
  return [
    new ActionRowBuilder().addComponents(menu),
    new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId("counter_save").setLabel("Create / Save").setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId("counter_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
    )
  ];
}

async function fetchMembers(guild){
  try{
    await guild.members.fetch();
    return guild.members.cache;
  }catch(error){
    console.error("Member fetch failed:",error);
    return guild.members.cache;
  }
}

async function roleCount(guild,roleId){
  if(!roleId) return 0;
  const role=guild.roles.cache.get(roleId);
  if(!role) {
    console.error(`Role ${roleId} was not found in ${guild.name}.`);
    return 0;
  }
  return role.members.size;
}

async function getValue(guild,type,members){
  if(type==="members") return members.size;
  if(type==="bots") return members.filter(m=>m.user.bot).size;
  if(type==="humans") return members.filter(m=>!m.user.bot).size;
  if(type==="channels") return guild.channels.cache.size;
  if(type==="roles") return guild.roles.cache.size;
  if(type==="staff") return members.filter(m=>!m.user.bot&&m.permissions.has(PermissionFlagsBits.ManageGuild)).size;
  if(type==="voice") return members.filter(m=>m.voice?.channelId).size;
  if(type==="pilots") return roleCount(guild,PILOT_ROLE_ID);
  if(type==="verified") return roleCount(guild,VERIFIED_ROLE_ID);
  if(type==="flights") return 0;
  return 0;
}

async function refresh(guild){
  const members=await fetchMembers(guild);
  const data=load();
  console.log(`Fetched ${members.size} members. Pilot role: ${PILOT_ROLE_ID||"NOT SET"}. Verified role: ${VERIFIED_ROLE_ID||"NOT SET"}.`);
  for(const c of data.counters){
    try{
      const channel=await guild.channels.fetch(c.channelId);
      const type=TYPES[c.type];
      if(!channel||!type) continue;
      const n=await getValue(guild,c.type,members);
      const name=`${type.emoji} ${type.label}: ${n}`;
      if(channel.name!==name) await channel.setName(name);
      console.log(`${type.label}: ${n}`);
    }catch(e){console.error(`Refresh failed for ${c.type}:`,e.message)}
  }
}

async function apply(guild,types){
  const selected=[...new Set(types)].filter(t=>Object.hasOwn(TYPES,t));
  const data=load(),wanted=new Set(selected);
  for(const c of data.counters){
    if(!wanted.has(c.type))try{
      const ch=await guild.channels.fetch(c.channelId);
      if(ch)await ch.delete("Counter removed by staff");
    }catch{}
  }
  data.counters=data.counters.filter(c=>wanted.has(c.type));
  for(const typeKey of selected){
    if(data.counters.some(c=>c.type===typeKey))continue;
    const t=TYPES[typeKey];
    const ch=await guild.channels.create({
      name:`${t.emoji} ${t.label}: 0`,
      type:ChannelType.GuildVoice,
      permissionOverwrites:[{
        id:guild.roles.everyone.id,
        deny:[PermissionFlagsBits.Connect,PermissionFlagsBits.Speak]
      }],
      reason:"Britain Airways Counter Bot"
    });
    data.counters.push({type:typeKey,channelId:ch.id});
  }
  save(data);
  await refresh(guild);
}

const commands=[
  new SlashCommandBuilder().setName("counter").setDescription("Manage Britain Airways counters.")
    .addSubcommand(s=>s.setName("create").setDescription("Choose counters to create."))
    .addSubcommand(s=>s.setName("edit").setDescription("Choose which counters exist."))
    .addSubcommand(s=>s.setName("refresh").setDescription("Refresh all counter values."))
    .addSubcommand(s=>s.setName("delete").setDescription("Delete all counter channels."))
].map(c=>c.toJSON());

client.once("ready",async()=>{
  try{
    const rest=new REST({version:"10"}).setToken(DISCORD_TOKEN);
    await rest.put(Routes.applicationGuildCommands(CLIENT_ID,GUILD_ID),{body:commands});
    const guild=await client.guilds.fetch(GUILD_ID);
    await refresh(guild);
    console.log(`Logged in as ${client.user.tag}`);
    console.log("Britain Airways Counter Bot is ready.");
  }catch(e){console.error("Startup error:",e)}
});

client.on("interactionCreate",async i=>{
  try{
    if(i.isChatInputCommand()&&i.commandName==="counter"){
      if(!staff(i))return i.reply({content:"🔒 Staff only.",flags:MessageFlags.Ephemeral});
      const sub=i.options.getSubcommand(),data=load();
      if(sub==="create"||sub==="edit"){
        return i.reply({
          embeds:[embed()],
          components:components(sub==="edit"?data.counters.map(c=>c.type):[]),
          flags:MessageFlags.Ephemeral
        });
      }
      if(sub==="refresh"){
        await i.deferReply({flags:MessageFlags.Ephemeral});
        await refresh(i.guild);
        return i.editReply("✅ Counters refreshed.");
      }
      if(sub==="delete"){
        await i.deferReply({flags:MessageFlags.Ephemeral});
        await apply(i.guild,[]);
        return i.editReply("🗑️ All counter channels deleted.");
      }
    }

    if(i.isStringSelectMenu()&&i.customId==="counter_select"){
      const selected=i.values.filter(v=>Object.hasOwn(TYPES,v));
      const menu=new StringSelectMenuBuilder()
        .setCustomId(`counter_selection:${selected.join(",")}`)
        .setPlaceholder(`${selected.length} selected`)
        .setMinValues(1)
        .setMaxValues(Object.keys(TYPES).length)
        .addOptions(Object.entries(TYPES).map(([value,t])=>({
          label:t.label,description:t.description,value,emoji:t.emoji,default:selected.includes(value)
        })));
      return i.update({
        embeds:[embed()],
        components:[
          new ActionRowBuilder().addComponents(menu),
          new ActionRowBuilder().addComponents(
            new ButtonBuilder().setCustomId(`counter_save:${selected.join(",")}`).setLabel("Create / Save").setStyle(ButtonStyle.Success),
            new ButtonBuilder().setCustomId("counter_cancel").setLabel("Cancel").setStyle(ButtonStyle.Secondary)
          )
        ]
      });
    }

    if(i.isButton()&&i.customId.startsWith("counter_save:")){
      if(!staff(i))return i.reply({content:"🔒 Staff only.",flags:MessageFlags.Ephemeral});
      const raw=i.customId.substring("counter_save:".length);
      const selected=raw?raw.split(",").filter(v=>Object.hasOwn(TYPES,v)):[];
      await i.deferUpdate();
      await apply(i.guild,selected);
      return i.editReply({
        content:`✅ Counter setup saved — **${selected.length}** selected.`,
        embeds:[],components:[]
      });
    }

    if(i.isButton()&&i.customId==="counter_cancel"){
      return i.update({content:"❌ Cancelled.",embeds:[],components:[]});
    }
  }catch(e){
    console.error("Interaction error:",e);
    try{
      if(i.replied||i.deferred)await i.editReply({content:"❌ Something went wrong. Check Railway logs.",embeds:[],components:[]});
      else await i.reply({content:"❌ Something went wrong. Check Railway logs.",flags:MessageFlags.Ephemeral});
    }catch{}
  }
});

client.on("error",e=>console.error("Discord client error:",e));
process.on("unhandledRejection",e=>console.error("Unhandled rejection:",e));
process.on("uncaughtException",e=>console.error("Uncaught exception:",e));

client.login(DISCORD_TOKEN);
