import 'reflect-metadata';
import {it,expect} from 'vitest';
import {Test} from '@nestjs/testing';
import {JwtService} from '@nestjs/jwt';
import request from 'supertest';
import {randomUUID} from 'node:crypto';
import {AppModule} from '../app.module.js';
import {PrismaService} from '../infra/prisma.service.js';
it('contrato frontend: yo, desambiguación, pago y cocina con readback PostgreSQL',async()=>{
 process.env['JWT_SECRET']=randomUUID();
 const app=(await Test.createTestingModule({imports:[AppModule]}).compile()).createNestApplication();
 await app.init();const db=app.get(PrismaService);const loc='test-frontend-'+randomUUID();
 try {
 await db.location.create({data:{id:loc,nombre:'TEST frontend sin dinero real'}});
 const tokens:Record<string,string>={};const ids:Record<string,string>={};
 for(const rol of ['CAJA','COCINA'] as const){const u=await db.user.create({data:{locationId:loc,nombre:'TEST '+rol,rol,pinHash:'not-a-login-hash'}});ids[rol]=u.id;tokens[rol]=app.get(JwtService).sign({sub:u.id,rol,nombre:u.nombre,locationId:loc});}
 const yo=await request(app.getHttpServer()).get('/auth/yo').auth(tokens['CAJA']!,{type:'bearer'}).expect(200);
 expect(yo.body).toMatchObject({id:ids['CAJA'],rol:'CAJA',nombre:'TEST CAJA',locationId:loc});expect(yo.body).not.toHaveProperty('pinHash');
 const orders=[];for(let n=1;n<=2;n++)orders.push(await db.order.create({data:{locationId:loc,numero:n,fecha:new Date(),nombreCliente:'TEST frontend '+n,tipo:'PARA_LLEVAR',subtotal:4500,total:4500,intentoUuid:randomUUID()}}));
 const get=(path:string,role='CAJA')=>request(app.getHttpServer()).get(path).auth(tokens[role]!,{type:'bearer'});
 const post=(path:string,body:object)=>request(app.getHttpServer()).post(path).auth(tokens['CAJA']!,{type:'bearer'}).send(body);
 const search=await get('/admin/payments/buscar?total=4500').expect(200);expect(search.body).toMatchObject({cantidad:2,ambiguo:true});
 await post('/admin/payments/confirmar-por-monto',{montoRecibido:4500}).expect(409);
 const id=orders[1]!.id;
 await post('/admin/payments/confirmar',{orderId:id,montoRecibido:4500}).expect(200);
 expect((await get('/orders/'+id+'/estado').expect(200)).body.estado).toBe('PAGADO');
 expect(await db.order.findUnique({where:{id}})).toMatchObject({estado:'PAGADO',confirmadoPorId:ids['CAJA']});
 expect((await get('/kitchen/orders','COCINA').expect(200)).body.map((x:{id:string})=>x.id)).toEqual([id]);
 for(const estado of ['EN_PREPARACION','LISTO','ENTREGADO']){
 await request(app.getHttpServer()).patch('/kitchen/orders/'+id+'/estado').auth(tokens[estado==='ENTREGADO'?'CAJA':'COCINA']!,{type:'bearer'}).send({estado}).expect(200);
 expect((await get('/orders/'+id+'/estado')).body.estado).toBe(estado);
 expect((await db.order.findUnique({where:{id}}))!.estado).toBe(estado);
 }
 expect((await get('/kitchen/orders','COCINA')).body).toEqual([]);
 expect(await db.auditLog.count({where:{orderId:id}})).toBe(2);
 expect((await db.order.findUnique({where:{id:orders[0]!.id}}))!.estado).toBe('PENDIENTE_PAGO');
 }finally{
 await db.auditLog.deleteMany({where:{order:{locationId:loc}}});await db.order.deleteMany({where:{locationId:loc}});await db.user.deleteMany({where:{locationId:loc}});await db.location.deleteMany({where:{id:loc}});
 expect(await db.location.count({where:{id:loc}})).toBe(0);await app.close();
 }
});
