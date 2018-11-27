const functions = require('firebase-functions');
const admin = require('firebase-admin');
var moment = require('moment');

//Disparo de E-mail
const nodemailer = require('nodemailer');
var qs = require("querystring");
var http = require("http");
var request = require("request");

//Package SendinBlue///////////////////////////////////////////////////////////////////////////////////
var sendinblue = require('sendinblue-api');

/////////////////////////////////////////////////////////////////////////////////////////////////////////


admin.initializeApp(functions.config().firebase);

const APP_NAME = 'OnClock';

//Função para criar a estrutura de Notifications e Status do Usuário dentro da Empresa
exports.setInitialInfoUser = functions.database.ref('/companies/{company}/users/{user}')
    .onCreate((snapshot, context) => {

        const company = context.params.company;
        const user = snapshot.val();

        //var ref = snapshot.ref.child('notifications');
        var ref = snapshot.ref;

        var approval = {};
        approval["overtime"] = 0;
        approval["comptime"] = 0;
        approval["medical"] = 0;
        approval["vacation"] = 0;

        var notifications = {};
        notifications["overtime"] = 0;
        notifications["comptime"] = 0;
        notifications["medical"] = 0;
        notifications["vacation"] = 0;
        notifications["approval"] = approval;
    
        user["status"] = "Ativo";
        user["notifications"] = notifications;

        return ref.update(user)
            .then(function (response) {

                console.log(`Estrutura notifications e status criados com sucesso para usuário ID: ${user}, da empresa: " ${company}`);

            })
            .catch(function (error) {

                console.log(`Erro ao criar estrutura notifications e status para usuário ID: ${user}, da empresa: " ${company}`);

            });

    });

//Quando criado um novo usuário na base, criar o nó de Horas Acumuladas inicialmente com valores zerados
exports.setAccumulated = functions.database.ref('/companies/{company}/{user}/')
    .onCreate((snapshot, context) => {

        const company = context.params.company;
        const user = context.params.user;

        var ref = snapshot.ref.child('accumulated');

        var accumulated = {};
        accumulated["overtime"] = "00:00";
        accumulated["comptime"] = "00:00";

        return ref.update(accumulated)
            .then(function (response) {

                console.log(`Estrutura accumulated criada com sucesso para usuário ID: ${user}, da empresa: " ${company}`);

            })
            .catch(function (error) {

                console.log(`Erro ao criar estrutura accumulated para usuário ID: ${user}, da empresa: " ${company}`);

            });

    });


exports.calculateBadge = functions.database.ref('/companies/{company}/users/{user}/notifications')
    .onUpdate((change, context) => {

        const company = context.params.company;
        const user = context.params.user;

        var notifications = change.after.val();
        var approval = notifications.approval;

        var total = notifications.overtime + notifications.comptime + notifications.medical + notifications.vacation + approval.overtime + approval.comptime + approval.medical + approval.vacation;

        return change.after.ref.child('total').set(total);

    });


exports.updateTeam = functions.database.ref('/companies/{company}/users/{user}/info/approver')
    .onWrite((change, context) => {

        const company = context.params.company;
        const user = context.params.user;
        const newApprover = change.after.val();
        const oldApprover = change.before.val();

        var ref = change.after.ref.parent

        return ref.once('value').then(function (snapshot) {

            const info = snapshot.val();
            const email = info.email;
            const name = info.name;

            // Se existia aprovador antigo, diferente de vazio, então deleta do team
            if (change.before.exists() && oldApprover !== "") {

                var ref2 = admin.database().ref('/companies/' + company + '/users/' + oldApprover + '/team/' + user);

                ref2.remove()
                    .then(function (response) {

                        console.log(`Empresa: ${company} / Usuário: ${user} removido do time do aprovador: ${oldApprover}`);

                    })
                    .catch(function (error) {

                        console.log(`Empresa: ${company} - Erro ao remover usuário: ${user} do aprovador: ${oldApprover}. Erro: ${error}`);

                    });

            }

            // Se existe novo aprovador, diferente de vazio, então insere no team
            if (change.after.exists() && newApprover !== "") {

                var ref2 = admin.database().ref('/companies/' + company + '/users/' + newApprover + '/team/' + user);

                var values = {};
                values["email"] = email;
                values["name"] = name;

                ref2.update(values)
                    .then(function (response) {

                        console.log(`Empresa: ${company} / Usuário: ${user} incluído no time do aprovador: ${newApprover}`);

                    })
                    .catch(function (error) {

                        console.log(`Empresa: ${company} - Erro ao incluir usuário: ${user} no time do aprovador: aprovador: ${newApprover}. /n Erro: ${error}`);

                    });

            }

        });

    });


//ALteração em Horas Extas ou Banco  do usuário
exports.newOvertimeRequest = functions.database.ref('/companies/{company}/overtime/{user}/{year}/{month}/{day}/{request}')
    .onCreate((snapshot, context) => {

        const company = context.params.company;
        const user = context.params.user;

        return sendRequestNotification("overtime", "Horas Adicionais", company, user);

    });

//ALteração em Compensação de Horas do usuário
exports.newComptimeRequest = functions.database.ref('/companies/{company}/comptime/{user}/{year}/{month}/{day}/{request}')
    .onCreate((snapshot, context) => {

        const company = context.params.company;
        const user = context.params.user;

        return sendRequestNotification("comptime", "Compensação de Horas", company, user);

    });

//ALteração em Faltas do usuário
exports.newMedicalRequest = functions.database.ref('/companies/{company}/medical/{user}/{year}/{month}/{day}/{request}')
    .onCreate((snapshot, context) => {

        const company = context.params.company;
        const user = context.params.user;

        return sendRequestNotification("medical", "Ausência Remunerada", company, user);

    });

//ALteração em férias do usuário
exports.newVacationRequest = functions.database.ref('/companies/{company}/vacation/{user}/{year}/{request}')
    .onCreate((snapshot, context) => {

        const company = context.params.company;
        const user = context.params.user;

        return sendRequestNotification("vacation", "Férias", company, user);

    });


function sendRequestNotification(type, typeName, company, user) {

    var ref1 = admin.database().ref('/companies/' + company + '/users/' + user + '/info');
    return ref1.once('value').then(function (snapshot2) {

        var data = snapshot2.val();

        // Tratar quando não tiver aprovador
        if (data.approver === undefined || data.approver === "") {
            console.log("Empresa " + company + ", usuário " + user + ". Aprovador não identificado.");
            return;
        }

        const approver = data.approver;

        const email = data.email;
        const name = data.name;

        var ref2 = admin.database().ref('/companies/' + company + '/users/' + approver + '/info');
        return ref2.once('value').then(function (snapshot3) {

            var data = snapshot3.val();

            const approverEmail = data.email;
            const approverName = data.name;
            const fcmTokens = data.fcmTokens;
            const tokens = Object.keys(fcmTokens);
            const tokensString = JSON.stringify(fcmTokens);

            var ref3 = admin.database().ref('/companies/' + company + '/users/' + approver + '/notifications/');

            ref3.child('total').once('value').then(function (snapshot4) {

                var badge = snapshot4.val() + 1;

                ref3.child('approval').transaction(function (approval) {

                    if (approval) {
                        eval(`approval.${type}++`);
                    }
                    return approval;

                });

                // Notification details.
                const payload = {
                    notification: {
                        title: 'Aprovação',
                        body: `${name} solicitou ${typeName}.`,
                        sound: 'default',
                        badge: `${badge}`
                    }
                };

                return admin.messaging().sendToDevice(tokens, payload)
                    .then(function (response) {

                        console.log(`Notificação de ${typeName} com sucesso na empresa ${company}. \nOrigem: \n - Nome: ${name} \n - E-mail: ${email} \n - ID: ${user} \nDestino: \n - Nome: ${approverName} \n - E-mail: ${approverEmail} \n - ID: ${approver} \n - fcmTokens: \n${tokensString}`);

                    })
                    .catch(function (error) {

                        console.log(`Erro ao enviar notificação de ${typeName} na empresa ${company}. \nOrigem: \n - Nome: ${name} \n - E-mail: ${email} \n - ID: ${user} \nDestino: \n - Nome: ${approverName} \n - E-mail: ${approverEmail} \n - ID: ${approver} \n - fcmTokens: \n${tokensString}`);

                    });

            });

        });

    });



}


//Atualiza notificações de Overtime
exports.overtimeRequestStatusDidChange = functions.database.ref('/companies/{company}/overtime/{user}/{year}/{month}/{day}/{request}/status')
    .onUpdate((change, context) => {

        const company = context.params.company;
        const user = context.params.user;
        const newStatus = change.after.val();
        const oldStatus = change.before.val();

        const day = context.params.day;
        const month = context.params.month;
        const year = context.params.year;
        const timestamp = `${year}-${month}-${day}`;
        updateOvertimeAccumulated(company, user, change, timestamp);

        return sendApprovalNotification("overtime", "Horas Adicionais", company, user, oldStatus, newStatus);

    });

exports.comptimeRequestStatusDidChange = functions.database.ref('/companies/{company}/comptime/{user}/{year}/{month}/{day}/{request}/statuss')
    .onUpdate((change, context) => {

        const company = context.params.company;
        const user = context.params.user;
        const newStatus = change.after.val();
        const oldStatus = change.before.val();

        const day = context.params.day;
        const month = context.params.month;
        const year = context.params.year;
        const timestamp = `${year}-${month}-${day}`;
        updateComptimeAccumulated(company, user, change, timestamp);

        return sendApprovalNotification("comptime", "Compensação de Horas", company, user, oldStatus, newStatus);

    });

exports.medicalRequestStatusDidChange = functions.database.ref('/companies/{company}/medical/{user}/{year}/{month}/{day}/{request}/status')
    .onUpdate((change, context) => {

        const company = context.params.company;
        const user = context.params.user;
        const newStatus = change.after.val();
        const oldStatus = change.before.val();

        return sendApprovalNotification("medical", "Ausência Remunerada", company, user, oldStatus, newStatus);

    });

exports.vacationRequestStatusDidChange = functions.database.ref('/companies/{company}/vacation/{user}/{year}/{request}')
    .onUpdate((change, context) => {

        const company = context.params.company;
        const user = context.params.user;
        const newStatus = change.after.val();
        const oldStatus = change.before.val();

        return sendApprovalNotification("vacation", "Férias", company, user, oldStatus, newStatus);

    });

/////////////////////////////////////////////// By Fábio //////////////////////////////////////////////////////////////////////



//Quando criado uma empresa, colocar status como ativo, criar history em "billing" e em "company > billing"
exports.newCompany = functions.database.ref('/companies/{company}/')
    .onCreate((snapshot, context) => {

        const company = context.params.company;

        var ref = snapshot.ref.child('billing');
    
        //atualiza status
        var status = "Ativo";
        return setStatusCompany(company, ref, status);
    
        //cria billing > history
        //return createBillingHistory(company, ref);    
        
    });


// Ao inativar o usuário, desativar o usuário na autenticação
exports.disableUserAuth = functions.database.ref('/users/{userid}/status')
    .onUpdate((change, context) => {    	   	

        const userid = context.params.userid;

        var newStatus = change.after.val();
        var oldStatus = change.before.val();
        
        
        if (newStatus === "Inativo" && oldStatus === "Ativo"){
        	
        	admin.auth().updateUser(userid, {
      		  
      		  disabled: true
      		  
      		})
      		  .then(function(userRecord) {
      		    // See the UserRecord reference doc for the contents of userRecord.
      		    console.log("Sucesso em desativar usuário.", userRecord.toJSON());
      		  })
      		  .catch(function(error) {
      		    console.log("Erro ao desativar usuário:", error);
      		  });        
      	
        	
        }if (newStatus === "Ativo" && oldStatus === "Inativo"){
        	
        	admin.auth().updateUser(userid, {
      		  
      		  disabled: false
      		  
      		})
      		  .then(function(userRecord) {
      		    // See the UserRecord reference doc for the contents of userRecord.
      		    console.log("Sucesso em ativar usuário.", userRecord.toJSON());
      		  })
      		  .catch(function(error) {
      		    console.log("Erro ao ativar usuário:", error);
      		  });        
      	
        	
        }


    });


// Function pra decrementar os dias do FreeCompanies
//3º Decrementa todos os dias e atualiza os dados do usuário no SendingBlue
exports.decrementDaysPlanFreeUpdateContact = functions.https.onRequest((req, resp) => {
    
    var card = "Completo";
    var address = "Completo";
    
    var ref1 = admin.database().ref('freeCompanies/');
    ref1.once('value').then(function (snapshot){
        
        snapshot.forEach(function (childSnapshot){
            
            //get info
            var company = childSnapshot.key;
            var name = childSnapshot.val().name;
            var email = childSnapshot.val().email;
            var addressIsValidated = childSnapshot.val().addressIsValidated;
            var cardIsValidated = childSnapshot.val().cardIsValidated;
            var days = childSnapshot.val().freeDays;
            
            console.log(`Dados recuperados: Empresa: ${company} / E-mail ADM: ${email} / Nome ADM: ${name} / Cartão: ${cardIsValidated} / Endereço: ${addressIsValidated} / Dias: ${days}`);
            
            
            if(days > 0){
                var newDays = days -1;
                
                //var ref2 = childSnapshot.ref.child("freeDays")
                var ref2 = admin.database().ref();
                
                var values = {};
                values[`companies/${company}/billing/freeDays`] = newDays;
                values[`freeCompanies/${company}/freeDays`] = newDays;
                
                console.log("Ref2: " + ref2);
                
                ref2.update(values).then(function (response){
                    
                    console.log(`Free Days (${newDays} dias) decrementado com sucesso na empresa: `+ company);
                    
                    //Verificar se o usuário já preencheu os dados de cartão, se sim, move para a lista geral
                    if(addressIsValidated === true && cardIsValidated === true){
                        
                        console.log("Cartão e Endereços validados.");
                        
                        var listId = 17;
                        
                        updateContactCampaignFreeDays(email, listId, name, address, card, newDays, company);
                        
                    }else{
                        
                        console.log(`Cartão ou Endereço NÃO validado: Cartão = ${cardIsValidated} / Endereço: ${addressIsValidated}`);
                        
                        if(cardIsValidated === false){
                            card = "Incompleto";
                            console.log("Cartão " + card);

                        }else{
                            card = "Completo";
                            console.log("Cartão " + card);
                        }
                        
                        if(addressIsValidated === false){
                            address = "Incompleto";
                            console.log("Endereço " + address);

                        }else{
                            address = "Completo";
                            console.log("Endereço " + address);
                        }             
                            
                        var listId = 4;
                        updateContactCampaignFreeDays(email, listId, name, address, card, newDays, company);                              
                        
                    }                    
                    
                    //updateFreeDaysCompany(company, newDays);
                    
                    
                }).catch(function (error){
                                        
                     console.log(`Erro ao decrementar freeDays ${error}`);
                    
                });

            }
            else{
                
                console.log(`${days} dia(s) restantes gratuitos. Inativa acesso e inseri na lista de Mkting No Purchase ou de Clientes.`);
                        
                //Caso o usuário não tenha comprado o plano, inativar acesso, se comprou, passar pra lista de Clientes
                
                if (!cardIsValidated || !addressIsValidated){
                    
                    setInactivePlanNoPurchase(company);                    
                }
                                     
            }
            
        });

    });
    
    resp.writeHead(200);
    resp.end();


});

function updateFreeDaysCompany(keyCompany, freeDays){
    
    if(keyCompany !== null){
        
        var ref = admin.database().ref('/companies/'+ keyCompany +'/billing');
        console.log("Referência: " + ref);
        
        return ref.child("freeDays").set(freeDays)
        
            .then(function (response){
                    
                    console.log("Novo valor em freedays: " + freeDays + " na empresa: " + keyCompany);
                    
                    
                }).catch(function (error){
                                        
                     console.log(`Erro ao decrementar freeDays dentro de Company: ${company} / Erro: ${error}`);
                    
                });
                        
    }
    
}

function setStatusCompany(company, ref, status){
    
        var billing = {
            status: status
        };
        
        
        return ref.update(billing)
                .then(function (response) {

                    console.log(`Estrutura billing com status Ativo criada com sucesso para empresa: ${company}`);

                })
                .catch(function (error) {

                    console.log(`Erro ao criar estrutura billing com status Ativo criada com sucesso para empresa: ${company}`);

                });
    
    
    
}

//Descontinuado
function createBillingHistory(company, ref){
    
    var ref2 = admin.database().ref().child("billing").push();
    
    var key = ref2.getKey();
    
    var date = moment();
    var initialDate = date.format("YYYY/MM/DD");    
    var finalDate = date.add(1, "month")
                        .subtract(1, "day")
                        .format("YYYY/MM/DD");
    
    console.log("Data criação: " + initialDate);
    
    var data = {
        
        initialDate: initialDate,
        finalDate: finalDate,
        company: company        
        
    };
    
    return ref2.update(data)
    
            .then(function (response) {

                        console.log(`Estrutura Billing criada com sucesso para empresa: ${company}`);
        
                        //cria company > billing > history    
                        return createCompanyBillingHistory(company, key, ref, initialDate, finalDate);

                    })
                    .catch(function (error) {

                        console.log(`Erro ao criar estrutura Billing criada com sucesso para empresa: ${company}`);

                    });  

    
}

//Descontinuado
function createCompanyBillingHistory(company, key, ref, initialDate, finalDate){
    
    console.log(`Criar Billing History na empresa: ${company}, com a chave: ${key}`);
    
    var ref2 = ref.child("history").child(key);
    
    var data = {
            initialDate: initialDate,
            finalDate: finalDate,
            fullMonth: true,
            minUsers: 1,
            paymentStatus: "Gratuito",
            plan: "-",
            totalPrice: "-",
            totalUsers: "-",
            unitPrice: 0.0
        
        };
        
        
        return ref2.update(data)
                .then(function (response) {

                    console.log(`Estrutura history da empresa: ${company} na chave: ${key} criado com sucesso.`);

                })
                .catch(function (error) {

                    console.log(`Erro ao criar estrutura billing na empresa: ${company}`);

                });
    
} 

//Envio de E-mails de Boas vindas
exports.getNewCompanyToSendEmail = functions.database.ref('companies/{company}/admin/email')
    .onCreate((snapshot, context) => {
    
    const company = context.params.company;
    const email = snapshot.val();
    var ref = snapshot.ref.parent.child('name');
    var name = "";
    
    
    
    return ref.once('value').then(function (snapshot2) {

        name = snapshot2.val();
        
        console.log(`Nova empresa cadastrada: ${company} / Usuário Adm: ${email} / Nome: ${name}`);
        
       //sendWelcomeEmail(email, name);
        
       return createEmailSendinBlue (email, name);
    
        
    }).catch(function (error) {
        
        name = "Indefinido";
        
        console.log(`Erro ao pegar nome do usuário: ${name}`);

    });



});

//Verificar se os dados para pagamento origem [ENDEREÇO] já foram inseridos, se sim, remove o usuário da lista de emails
exports.verifyAddressIsValidated = functions.database.ref('/companies/{company}/billing/address/isValidated')
    .onUpdate((change, context) => {

        const company = context.params.company;
        const addressIsValidated = change.after.val();
        
        console.log("Endereço validado? R: " + addressIsValidated);
        
        if(addressIsValidated === false){
            
            return console.log("O Endereço ainda não foi validado.");
            
        }else{
            
                var ref2 = admin.database().ref('/companies/'+company+'/admin/email');
                return ref2.once('value').then(function (snapshot2){
                    
                    var email = snapshot2.val();
                    
                    console.log("Email admin: " + email);
                    
                    if(email !== null){
                        
                         var ref3 = admin.database().ref('/companies/'+company+'/billing/creditCard/isValidated');
                         return ref3.once('value').then(function (snapshot3) {

                            var creditCardIsValidated = snapshot3.val();

                            console.log("Cartão validado? R: " + creditCardIsValidated);

                            //PAREI AQUI

                                if(creditCardIsValidated === true){

                                    // CHAMAR FUNÇÃO PARA TIRAR CONTATO DA LISTA
                                    return removeContactList(email, 16);                        
                        
                                }else{

                                    console.log("O Cartão de Crédito ainda não foi validado.");
                                    return;

                                }

                            });
                        
                    }else{
                        console.log("Email é nulo!");
                        return;
                    }
                                              
                });                        
            
        }

    });

//Verificar se os dados para pagamento origem [CARTÃO DE CRÉDITO] já foram inseridos, se sim, remove o usuário da lista de emails
exports.verifyCreditCardIsValidated = functions.database.ref('/companies/{company}/billing/creditCard/isValidated')
    .onUpdate((change, context) => {

        const company = context.params.company;
        const creditCardIsValidated = change.after.val();
        
        console.log("Cartão de Crédito validado? R: " + creditCardIsValidated);
        
       if(creditCardIsValidated === false){
            
            return console.log("O Cartão de Crédito ainda não foi validado.");
            
        }else{
            
                var ref2 = admin.database().ref('/companies/'+company+'/admin/email');
                return ref2.once('value').then(function (snapshot2){
                    
                    var email = snapshot2.val();
                    
                    console.log("Email admin: " + email);
                    
                    if(email !== null){
                        
                         var ref3 = admin.database().ref('/companies/'+company+'/billing/address/isValidated');
                         return ref3.once('value').then(function (snapshot3) {

                            var addressIsValidated = snapshot3.val();

                            console.log("Endereço validado? R: " + addressIsValidated);

                                if(addressIsValidated === true){

                                    // CHAMAR FUNÇÃO PARA TIRAR CONTATO DA LISTA
                                    return removeContactList(email, 16);                        
                        
                                }else{

                                    console.log("O Endereço ainda não foi validado.");
                                    return;

                                }

                            });
                        
                    }else{
                        console.log("Email é nulo! ");
                        return;
                    }
                                              
                });                        
            
        }

    });


/////////SendinBlue//////////////////////////////////////////////////////////////////////////////////
//1º Crio o usuário
function createEmailSendinBlue(email, name){
    
    var options = { method: 'POST',
                      headers:{
                       "Accept": 'application/json',
                       "Content-Type": 'application/json',
                       "api-key": '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'                    
                      },
                      url: 'https://api.sendinblue.com/v3/contacts',
                      body: 
                       { listIds: [ '18' ],
                         emailBlacklisted: 'false',
                         smsBlacklisted: 'false',
                         email: email,
                         attributes: {NOME: name}
                       },
                      json: true };

   return request(options, function (error, response, body) {
      if (error) throw new Error(error);

      console.log("Criar usuário > Dados do usuário > E-mail: " + email + " Name: " + name);
      console.log("Criar usuário > Response: " + response.code + " Status: " + response.status + " Descrição: " + response.description);        
      console.log("Criar usuário > Retorno body code: " + body.code + " Mensagem: " + body.message);
        
      //Inserindo na lista 4 do workflow
      return addEmailCampaignFreeDays(email, 4, name);
        
    });
    
}

//2º Adiciono o usuário na lista de campanha para Dias Grátis
function addEmailCampaignFreeDays(email, listId, name){
    
    console.log("Usuário a ser inserido na lista FreeDays: Email: " + email + "Name: " + name);

    
    var options = {   method: 'POST',
                      headers:{
                       "Accept": 'application/json',
                       "Content-Type": 'application/json',
                       "api-key": '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'                    
                      },
                      url: `https://api.sendinblue.com/v3/contacts/lists/${listId}/contacts/add`,
                      body:{ emails: [email],                           
                            attributes: {NOME: name}                           
                           },
                      json: true 

    };
    

    request(options, function (error, response, body) {
      if (error) throw new Error(error);
    
      console.log("Adicionar: E-mail: " + email + " Resultado: " + body.code + " Mensagem: " + body.message);
      
    });
    
}

//4º Atualização das informações do Usuário no SendinBlue
function updateContactCampaignFreeDays(email, listId, name, address, card, days, company){
    
    console.log("Usuário a ser atualizado na lista: Email: " + email + "Name: " + name + " ID lista: " + listId + " Empresa: " + company);
    
    var url = `https://api.sendinblue.com/v3/contacts/${email}`;
    
    console.log("URL Update Conferência: " + url);

    var options = {   method: 'PUT',
                      headers:{
                       "Accept": 'application/json',
                       "Content-Type": 'application/json',
                       "api-key": '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'                    
                      },
                      url: `https://api.sendinblue.com/v3/contacts/${email}`,
                      //url: 'https://api.sendinblue.com/v3/contacts/fabio%40jdstecnologia.com.br',
                      body:{listIds: ['4', listId],
                            attributes: {NOME: name,
                                         CREDITCARDISVALIDATED: card,
                                         ADDRESSISVALIDATED: address,
                                         FREEDAYS: days,
                                         COMPANY: company}                           
                           },
                      json: true 

    };
    

    request(options, function (error, response, body) {
      if (error) throw new Error(error);
        
        console.log(body);
      
    });
    
}

//5º Se usuário já não possui mais dias grátis, verifica o status dos cadastros e inseri nas listas 16-Continua campanha ou 17-Cliente
function setInactivePlanNoPurchase(company){
    
    var ref1 = admin.database().ref('/freeCompanies/' + company);
    return ref1.once('value').then(function (snapshot) {

        var email = snapshot.val().email;
        var status = "Inativo";
        var name = snapshot.val().name;
        
        var days = snapshot.val().freeDays;
        var card = "";
        var address = "";
        
        //Verificando se o cartão foi validado

        console.log("Cartão foi validado? " + cardIsValidated + " Empresa: " + company);
        console.log("Endereço foi validado? " + addressIsValidated + " Empresa: " + company);
        
        
        //var ref2 = admin.database().ref('/freeCompanies/' + company +'/status/');
        var ref2 = admin.database().ref();
                
        var values = {};
        values[`companies/${company}/billing/status`] = status;
        values[`freeCompanies/${company}/status`] = status;
        

        return ref2.update(values).then(function (response) {

                console.log("Empresa DESATIVADA: " + company);

                //Vejo se é o CARTÃO DE CRÉDITO que não foi preenchido
                if(cardIsValidated === false){
                    card = "Incompleto";
                }else{
                    card = "Completo";
                }            
            
                //Vejo se é o ENDEREÇO que não foi preenchido
                if(addressIsValidated === false){
                    address = "Incompleto";
                }else{
                    address = "Completo";
                }
            
                //Tirando e-mail do administrador da campanha freeDays e inserindo no Marketing NoPurchase
                updateContactCampaignFreeDays(email, 16, address, card, days, company);

            })
            .catch(function (error) {

                console.log("Erro ao DESATIVAR empresa: " + company);

            });
        
    });
    
}

function removeContactList(email, listId){
    
    console.log("E-mail: " + email + "  Lista: " + listId);
    
     var options = {   method: 'POST',
                      headers:{
                       "Accept": 'application/json',
                       "Content-Type": 'application/json',
                       "api-key": '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'                    
                      },
                      url: `https://api.sendinblue.com/v3/contacts/lists/${listId}/contacts/remove`,
                      body:{ emails: [email], all: false},
                      json: true 

    };
    

    request(options, function (error, response, body) {
      if (error) throw new Error(error);
    
      console.log("Adicionar: E-mail: " + email + " Resultado: " + body.code + " Mensagem: " + body.message);
      
    });
    
}

//////////////////////////////////////////////////////////Finish Fábio///////////////////////////////////////////////////////////////////////



function sendApprovalNotification(type, typeName, company, user, oldStatus, newStatus) {


    if (newStatus !== "Aprovado" && newStatus !== "Reprovado") {
        return;
    }

    var verb = "";

    if (newStatus === "Aprovado") {
        verb = "aprovou"
    } else {
        verb = "reprovou"
    }

    var ref1 = admin.database().ref('/companies/' + company + '/users/' + user + '/info');
    return ref1.once('value').then(function (snapshot2) {

        var data = snapshot2.val();

        const approver = data.approver;
        const email = data.email;
        const name = data.name;
        const fcmTokens = data.fcmTokens;
        const tokens = Object.keys(fcmTokens);
        const tokensString = JSON.stringify(fcmTokens);

        var ref2 = admin.database().ref('/companies/' + company + '/users/' + approver + '/info');
        return ref2.once('value').then(function (snapshot3) {

            var data = snapshot3.val();

            const approverEmail = data.email;
            const approverName = data.name;

            var ref3 = admin.database().ref('/companies/' + company + '/users/' + user + '/notifications/');
            return ref3.child('total').once('value').then(function (snapshot4) {

                var badge = snapshot4.val() + 1;

                var ref4 = admin.database().ref('/companies/' + company + '/users/' + approver + '/notifications/approval');
                ref4.transaction(function (approval) {

                    if (approval) {
                        
                        eval(`if (approval.${type} > 0) { approval.${type}--; }`);
                        
                    }
                    
                    return approval;

                });

                var ref5 = admin.database().ref('/companies/' + company + '/users/' + user + '/notifications/');
                ref5.transaction(function (notifications) {

                    if (notifications) {
                        eval(`notifications.${type}++;`);
                    }
                    return notifications;

                });


                // Notification details.
                const payload = {
                    notification: {
                        title: 'Aprovação',
                        body: `${approverName} ${verb} sua solicitação de ${typeName}.`,
                        sound: 'default',
                        badge: `${badge}`
                    }
                };

                return admin.messaging().sendToDevice(tokens, payload)
                    .then(function (response) {

                        console.log(`Notificação de Aprovação de ${typeName} enviada com sucesso na empresa ${company}". \nOrigem: \n - Nome: ${approverName} \n - E-mail: ${approverEmail} \n - ID: ${approver} \nDestino: \n - Nome: ${name} \n - E-mail: ${email} \n - ID: ${user} \n - fcmToken: ${tokensString}`);

                    })
                    .catch(function (error) {

                        console.log(`Erro ao enviar notificação de Aprovação de ${typeName} na empresa ${company}. \nOrigem: \n- Nome: ${approverName} \n- E-mail: ${approverEmail} \n- ID: ${approver} \nDestino: \n- Nome: ${name} \n- E-mail: ${email} \n- ID: ${user} \n - fcmToken: ${tokensString} \nErro: ${error}`);

                    });

            });

        });

    });

}


//Calculo das horas acumuladas
function updateOvertimeAccumulated(company, user, change, timestamp) {

    const newStatus = change.after.val();
    const oldStatus = change.before.val();

//    if (oldStatus !== "Solicitado" || newStatus !== "Aprovado") {
//        return;
//    }
    
    //Compara se é de fato "Aprovado", se não for, não necessita realizar o cálculo
    if (newStatus !== Aprovado){
    	return;
    }

        var ref1 = change.after.ref.parent;
        return ref1.once('value').then(function (snapshot) {

                const request = snapshot.val();

                const initialHourString = request.initialHour;
                const finalHourString = request.finalHour;
                const type = request.type;

                const initialHour = moment(initialHourString, "HH:mm");
                const finalHour = moment(finalHourString, "HH:mm");

                var duration = moment.duration(finalHour.diff(initialHour));
                var minutes = duration.asMinutes();

                var index;
                if (type === "Extra") {
                    index = "overtime";
                } else {
                    index = "comptime";
                }

                var ref2 = admin.database().ref('/companies/' + company + '/accumulated/' + user + index);
                ref2.once('value').then(function (snapshot) {

                    var timeString = snapshot.val(); // -7

                    var newTimeString = calculateTimeByAddingMinutes(timeString, minutes);

                    ref2.set(newTimeString)
                        .then(function (response) {

                            var zeroHour = moment("00:00", "HH:mm");
                            var diference = zeroHour.add(minutes, 'minutes');
                            diferenceString = diference.format("HH:mm");

                    }).catch(function (error) {

                            console.log(`Acumulado - Erro. Empresa: ${company}. Usuário: ${user}. Tipo: ${type}. Histórico atualizado: ${timestamp}: ${diferenceString}. Erro: ${error}.`);

                        });

                });

        });

}



//Atualização das Compensações de Horas Acumuladas
function updateComptimeAccumulated(company, user, change, timestamp) {

    const newStatus = change.after.val();
    const oldStatus = change.before.val();

  //Compara se é de fato "Aprovado", se não for, não necessita realizar o cálculo
    if (newStatus !== Aprovado){
    	return;
    }

    var ref1 = change.after.ref.parent;
    return ref1.once('value').then(function (snapshot) {

        const request = snapshot.val();

        const initialHourString = request.initialHour;
        const finalHourString = request.finalHour;

        const initialHour = moment(initialHourString, "HH:mm");
        const finalHour = moment(finalHourString, "HH:mm");

        var duration = moment.duration(finalHour.diff(initialHour));
        var minutes = duration.asMinutes();

        var ref2 = admin.database().ref('/companies/' + company + '/accumulated/' + user + '/comptime');
        ref2.once('value').then(function (snapshot) {

            var timeString = snapshot.val();
            var newTimeString = calculateTimeBySubtractingMinutes(timeString, minutes);

            ref2.set(newTimeString)
                .then(function (response) {

                    console.log(`Acumulado. Empresa: ${company}. Usuário: ${user}. Tipo: Banco (-). Minutos: ${minutes}. Acumulado anterior: ${timeString}. Novo acumulado: ${newTimeString}.`);

                    var zeroHour = moment("00:00", "HH:mm");
                    var diference = zeroHour.add(minutes, 'minutes');
                    diferenceString = diference.format("HH:mm");

                })
                .catch(function (error) {

                    console.log(`Acumulado - Erro. Empresa: ${company}. Usuário: ${user}. Tipo: Banco (-). Minutos: ${minutes}. Acumulado anterior: ${timeString}. Novo acumulado: ${newTimeString}. Erro: ${error}.`);

                });


        });

    });

}


function calculateTimeByAddingMinutes(timeString, minutes) {
    
    console.log(`calculateTimeByAddingMinutes`);

    var time = moment(timeString, "HH:mm"); // +7
    console.log(`timeString: ${timeString}, time: ${time}.`);

    var newTime;
    var newTimeString;

    if (timeString.charAt(0) !== "-") {

        newTime = time.add(minutes, 'minutes');
        newTimeString = newTime.format("HH:mm");

    } else {

        var zeroHour = moment("00:00", "HH:mm");
        var duration = moment.duration(time.diff(zeroHour)); // 7h
        var minutes2 = Math.abs(duration.asMinutes()); // 420min
        time = zeroHour.subtract(minutes2, 'minutes'); // 17h
        console.log(`duration: ${duration}, minutes2: ${minutes2}, time: ${time}.`);

        var timeDay = time.date(); // ontem
        newTime = time.add(minutes, 'minutes'); // 18h
        var newTimeDay = newTime.date(); // ontem
        console.log(`timeDay: ${timeDay}, newTime: ${newTime}, newTimeDay: ${newTimeDay}.`);

        var zeroHour2 = moment("00:00", "HH:mm");
        var duration2 = moment.duration(zeroHour2.diff(newTime)); // 6h
        var minutes3 = Math.abs(duration2.asMinutes()); // 360min
        var newTime2 = zeroHour2.add(minutes3, 'minutes'); // 6h
        console.log(`duration2: ${duration2}, minutes2: ${minutes3}, newTime2: ${newTime2}.`);

        if (timeDay === newTimeDay) { // false

            newTimeString = `-${newTime2.format("HH:mm")}`; // -2h

        } else {

            newTimeString = newTime2.format("HH:mm"); // 2h

        }

    }

    console.log(`newTimeString: ${newTimeString}.`);

    return newTimeString;

}


function calculateTimeBySubtractingMinutes(timeString, minutes) {
    
    console.log(`calculateTimeBySubtractingMinutes`);

    var time = moment(timeString, "HH:mm");
    console.log(`timeString: ${timeString}, time: ${time}.`);

    var newTime;
    var newTimeString;

    if (timeString.charAt(0) === "-") {

        newTime = time.add(minutes, 'minutes');
        newTimeString = `-${newTime.format("HH:mm")}`;

    } else {

        var timeDay = time.date();
        newTime = time.subtract(minutes, 'minutes');
        var newTimeDay = newTime.date();
        console.log(`timeDay: ${timeDay}, newTime: ${newTime}, newTimeDay: ${newTimeDay}.`);

        if (timeString === "00:00" || timeDay !== newTimeDay) {

            var zeroHour = moment("00:00", "HH:mm");
            var duration = moment.duration(zeroHour.diff(newTime));
            var minutes2 = duration.asMinutes();
            newTime = zeroHour.add(minutes2, 'minutes');
            newTimeString = `-${newTime.format("HH:mm")}`;
            console.log(`duration: ${duration}, minutes2: ${minutes2}, newTime: ${newTime}.`);

        } else {

            newTimeString = newTime.format("HH:mm");

        }

    }
    
    console.log(`newTimeString: ${newTimeString}.`);
    
    return newTimeString;    

}