import React,{createContext,useContext,useState,useCallback,useEffect} from 'react';
import {Platform} from 'react-native';
import Constants from 'expo-constants';
import {request,ApiError} from './client';
import type {User} from './types';
import {setApiUrlPorDefecto,getApiUrl,cargarApiUrl} from './config';
const host=Platform.OS==='web'&&typeof location!=='undefined'?location.hostname:(Constants.expoConfig?.hostUri?.split(':')[0]??'localhost');
setApiUrlPorDefecto(process.env.EXPO_PUBLIC_API_URL??`http://${host}:3000`);
/** Direccion vigente de la API. En un APK instalado la define la pantalla de ajustes. */
export const apiUrl=()=>getApiUrl();
type Session={user:User|null;call:<T>(path:string,method?:string,body?:unknown)=>Promise<T>;login:(pin:string)=>Promise<void>;logout:()=>void;apiUrl:string;recargarApiUrl:()=>Promise<void>};
const Context=createContext<Session>(null!);
export function SessionProvider({children}:{children:React.ReactNode}) {
 const [token,setToken]=useState(''); const [user,setUser]=useState<User|null>(null);
 const [base,setBase]=useState(getApiUrl());
 const recargarApiUrl=useCallback(async()=>{setBase(await cargarApiUrl());},[]);
 useEffect(()=>{void recargarApiUrl();},[recargarApiUrl]);
 const logout=useCallback(()=>{setToken('');setUser(null);},[]);
 const call=useCallback(async<T,>(path:string,method='GET',body?:unknown)=>{try{return await request<T>(getApiUrl(),path,{method,body:body===undefined?undefined:JSON.stringify(body),headers:token?{Authorization:`Bearer ${token}`}:{}});}catch(e){if(e instanceof ApiError&&e.status===401)logout();throw e;}},[token,logout]);
 async function login(pin:string){const result=await request<{token:string;usuario:User}>(getApiUrl(),'/auth/login',{method:'POST',body:JSON.stringify({pin})});const actual=await request<User>(getApiUrl(),'/auth/yo',{headers:{Authorization:`Bearer ${result.token}`}});setToken(result.token);setUser(actual);}
 return <Context.Provider value={{user,call,login,logout,apiUrl:base,recargarApiUrl}}>{children}</Context.Provider>;
}
export const useSession=()=>useContext(Context);
export function usePoll<T>(path:string|null,interval=5000) {
 const {call}=useSession(); const [data,setData]=useState<T|null>(null); const [error,setError]=useState('');const [updated,setUpdated]=useState(''); const [busy,setBusy]=useState(false);
 const refresh=useCallback(async()=>{if(!path)return;setBusy(true);try{setData(await call<T>(path));setError('');setUpdated(new Date().toLocaleTimeString());}catch(e){setError(e instanceof Error?e.message:'Error');}finally{setBusy(false);}},[path,call]);
 useEffect(()=>{setData(null);void refresh();const timer=setInterval(()=>void refresh(),interval);return()=>clearInterval(timer);},[refresh,interval]);
 return {data,error,updated,busy,refresh};
}
