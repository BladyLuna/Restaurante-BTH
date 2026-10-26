import React,{useState} from 'react';
import {View,Text} from 'react-native';
import {router,Redirect} from 'expo-router';
import {Page,Button,Field,Notice,Badge,useUi} from '../../shared/ui';
import {useSession} from '../../shared/api/session';
import {errorMessage} from '../../shared/api/errors';
import {destinoSegunRol} from '../../features/domain';

export default function Ingresar(){
 const {user,login}=useSession();
 const {s}=useUi();
 const [pin,setPin]=useState('');
 const [error,setError]=useState('');
 const [busy,setBusy]=useState(false);

 // Quien ya tiene sesión no vuelve a ver esta pantalla: va directo a su puesto.

 async function entrar(){
  setBusy(true);setError('');
  const valor=pin;setPin('');
  try{await login(valor);}
  catch(e){setError(errorMessage(e));}
  finally{setBusy(false);}
 }

 if(user) return <Redirect href={destinoSegunRol(user.rol)}/>;

 return <Page title="Entrar al sistema" subtitle="Escribí tu PIN. El sistema te lleva a tu puesto.">
  <View style={s.cardRaised}>
   <Badge tone="info" text="Acceso del personal"/>
   <Text style={s.subtitle}>Tu PIN personal</Text>
   <Text style={s.muted}>Cada persona tiene el suyo. La sesión no se guarda: al cerrar la app hay que entrar de nuevo.</Text>
   <Field label="PIN" hint="Mínimo 4 dígitos." value={pin} onChangeText={setPin} secureTextEntry keyboardType="number-pad" maxLength={12} autoComplete="off" onSubmitEditing={()=>{if(pin.length>=4&&!busy)void entrar();}}/>
   <Notice tone="error" text={error}/>
   {/* El boton se mantiene deshabilitado (con color propio, no solo translucido)
       hasta que el PIN tiene largo valido; el spinner marca la verificacion. */}
   <Button title={busy?'Verificando…':'Entrar'} loading={busy} disabled={pin.length<4} onPress={()=>void entrar()}/>
  </View>
  <View style={s.card}>
   <Text style={s.muted}>¿Sos cliente? No necesitás PIN: volvé al inicio y tocá "Ver menú y pedir".</Text>
   <Button title="Volver al inicio" secondary onPress={()=>router.replace('/')}/>
  </View>
 </Page>;
}
