import {router} from 'expo-router';
import {View,Text} from 'react-native';
import {Page,Button,Badge,space,useUi} from '../shared/ui';
import {useSession} from '../shared/api/session';
import {destinoSegunRol} from '../features/domain';
export default function Home(){
 const {apiUrl,user,logout}=useSession();
 const {s}=useUi();
 return <Page title="Buen provecho." subtitle="Elegí tu espacio. Un pedido claro, de la mesa a la cocina.">
  {/* Tarjeta heroe: el camino del cliente es la unica accion primaria de la pantalla. */}
  <View style={[s.cardRaised,{gap:space.md}]}>
   <Badge tone="warn" text="Para clientes"/>
   <Text style={s.title}>¿Qué vas a disfrutar hoy?</Text>
   <Text style={s.text}>Elegí tus platos, revisá el total y pagá con el QR estático del local.</Text>
   <Button title="Ver menú y pedir →" onPress={()=>router.push('/kiosk')}/>
  </View>

  {/* Personal: misma informacion, jerarquia visual mas baja (secundario y ghost). */}
  <View style={s.card}>
   <Badge tone="info" text="Personal del local"/>
   <Text style={s.subtitle}>Caja y cocina</Text>
   {user
    ?<><View style={s.row}>
       <Text style={[s.textStrong,{flex:1,minWidth:140}]}>{user.nombre}</Text>
       <Badge tone="neutral" text={user.rol}/>
      </View>
      <View style={s.row}>
       <Button grow title="Ir a mi puesto" onPress={()=>router.push(destinoSegunRol(user.rol))}/>
       <Button title="Cerrar sesión" variant="ghost" onPress={logout}/>
      </View></>
    :<><Text style={s.muted}>Caja y cocina necesitan PIN. Entrá una vez y el sistema te lleva a tu puesto.</Text>
      <Button title="Entrar con mi PIN" secondary onPress={()=>router.push('/ingresar')}/></>}
  </View>

  <View style={[s.card,s.row]}>
   <Text style={[s.muted,{flex:1,minWidth:180}]}>Conectado a {apiUrl}</Text>
   <Button title="Ajustes de conexión" variant="ghost" onPress={()=>router.push('/ajustes')}/>
  </View>
 </Page>;
}
