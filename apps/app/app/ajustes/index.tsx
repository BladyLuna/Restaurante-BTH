import React,{useState,useEffect} from 'react';
import {View,Text} from 'react-native';
import {router} from 'expo-router';
import {Page,Button,Field,Notice,Badge,useUi,type NoticeTone} from '../../shared/ui';
import {useSession} from '../../shared/api/session';
import {guardarApiUrl,olvidarApiUrl,apiUrlPorDefecto,normalizarApiUrl} from '../../shared/api/config';
import {request} from '../../shared/api/client';

export default function Ajustes(){
 const {apiUrl,recargarApiUrl}=useSession();
 const {s}=useUi();
 const [texto,setTexto]=useState('');
 const [aviso,setAviso]=useState('');
 const [probando,setProbando]=useState(false);

 useEffect(()=>{setTexto(apiUrl);},[apiUrl]);

 // Solo presentacion: deduce el tono del aviso por su contenido, sin cambiar el texto.
 const tono:NoticeTone=aviso.startsWith('Conectó bien')||aviso.startsWith('Guardado')?'success'
  :aviso.startsWith('No contestó')||aviso.startsWith('Esa dirección')?'error'
  :aviso.startsWith('Probando')?'info':'warn';

 async function probar(){
  const destino=normalizarApiUrl(texto);
  if(!destino){setAviso('Esa dirección no se entiende. Escribí la IP del ordenador, por ejemplo 192.168.0.100');return;}
  setProbando(true);setAviso('Probando '+destino+' …');
  try{
   await request<unknown>(destino,'/catalog');
   setAviso('Conectó bien con '+destino+'. Ya podés guardar.');
  }catch(e){
   setAviso('No contestó: '+(e instanceof Error?e.message:'error')+'. Revisá que el ordenador y el celular estén en la misma WiFi y que la API esté encendida.');
  }finally{setProbando(false);}
 }

 async function guardar(){
  const guardado=await guardarApiUrl(texto);
  if(!guardado){setAviso('Esa dirección no se entiende. Escribí la IP del ordenador, por ejemplo 192.168.0.100');return;}
  await recargarApiUrl();
  setAviso('Guardado: '+guardado);
 }

 async function restablecer(){
  await olvidarApiUrl();
  await recargarApiUrl();
  setTexto(apiUrlPorDefecto());
  setAviso('Volvió al valor por defecto: '+apiUrlPorDefecto());
 }

 return <Page title="Ajustes de conexión" subtitle="Dónde está el sistema. Se guarda en este dispositivo.">
  <View style={s.cardRaised}>
   <Badge tone="neutral" text="Conexión actual"/>
   <Text style={s.textStrong}>Usando ahora: {apiUrl}</Text>
   <Field label="Dirección del ordenador (IP o URL)" hint="Si escribís solo la IP se usa el puerto 3000. El ordenador y el celular tienen que estar en la misma WiFi." value={texto} onChangeText={setTexto} autoCapitalize="none" autoCorrect={false} keyboardType="url" placeholder="192.168.0.100"/>
   <View style={s.row}>
    <Button grow title={probando?'Probando…':'Probar conexión'} loading={probando} secondary onPress={()=>void probar()}/>
    <Button grow title="Guardar" onPress={()=>void guardar()}/>
   </View>
   <Notice tone={tono} text={aviso}/>
  </View>
  <View style={[s.card,s.row]}>
   <Button title="Volver al valor por defecto" variant="ghost" onPress={()=>void restablecer()}/>
   <Button title="Ir al inicio" secondary onPress={()=>router.replace('/')}/>
  </View>
 </Page>;
}
