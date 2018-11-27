const functions = require('firebase-functions');
const admin = require('firebase-admin');
var moment = require('moment');
var md5 = require("blueimp-md5");
//var VMasker = require('vanilla-masker');
require('es6-promise').polyfill();
require('isomorphic-fetch');
var CryptoJS = require("crypto-js");

admin.initializeApp(functions.config().firebase);


/*
    Função para setar os contadores de notificação
    Mário Galvão - 23/10/2018
*/
exports.setNotificationCounters = functions.database.ref('/companies/{company}/users/{user}')
    .onCreate((snapshot, context) => {

        const company = context.params.company;
        const user = context.params.user;

        var ref = snapshot.ref.child('notifications');

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

        return ref.update(notifications)
            .then(function (response) {

                console.log("Estrutura notifications criada com sucesso para usuário ID " + user + " da empresa " + company);

            })
            .catch(function (error) {

                console.log("Erro ao criar estrutura notifications para usuário ID " + user + " da empresa " + company);

            });

    });


/*
    Função para setar os contadores de horas extras e banco de horas acumulados
    Mário Galvão - 23/10/2018
*/
exports.setAccumulated = functions.database.ref('/companies/{company}/users/{user}')
    .onCreate((snapshot, context) => {

        const company = context.params.company;
        const user = context.params.user;

        var ref = snapshot.ref.child('accumulated');

        var accumulated = {};
        accumulated["overtime"] = "00:00";
        accumulated["comptime"] = "00:00";

        return ref.update(accumulated)
            .then(function (response) {

                console.log("Estrutura accumulated criada com sucesso para usuário ID " + user + " da empresa " + company);

            })
            .catch(function (error) {

                console.log("Erro ao criar estrutura accumulated para usuário ID " + user + " da empresa " + company);

            });

    });


/*
    Função para atualizar a badge da próxima notificação
    Mário Galvão - 25/10/2018
*/
exports.calculateBadge = functions.database.ref('/companies/{company}/users/{user}/notifications')
    .onUpdate((change, context) => {

        const company = context.params.company;
        const user = context.params.user;

        var notifications = change.after.val();
        var approval = notifications.approval;

        var total = notifications.overtime + notifications.comptime + notifications.medical + notifications.vacation + approval.overtime + approval.comptime + approval.medical + approval.vacation;

        return change.after.ref.child('total').set(total);

    });


/*
    Função para atualizar a equipe de cada usuário
    Mário Galvão - 30/10/2018
*/
exports.updateTeam = functions.database.ref('/companies/{company}/users/{user}/info/approver')
    .onWrite((change, context) => {

        const company = context.params.company;
        const user = context.params.user;
        const newApprover = change.after.val();
        const oldApprover = change.before.val();

        var ref = change.after.ref.parent;

        return ref.once('value').then(function (snapshot) {

            const info = snapshot.val();
            const email = info.email;
            const name = info.name;

            // Se existia aprovador antigo, diferente de vazio, então deleta do team
            if (change.before.exists() && oldApprover !== "") {

                var ref2 = admin.database().ref('/companies/' + company + '/users/' + oldApprover + '/team/' + user);

                ref2.remove()
                    .then(function (response) {

                        console.log("Empresa: " + company + ". Usuário " + user + " removido do time do aprovador " + oldApprover);

                    })
                    .catch(function (error) {

                        console.log("Empresa: " + company + ". Erro ao remover usuário " + user + " do aprovador " + oldApprover + ". Erro: " + error);

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

                        console.log("Empresa: " + company + ". Usuário " + user + " incluído no time do aprovador " + newApprover);

                    })
                    .catch(function (error) {

                        console.log("Empresa: " + company + ". Erro ao incluir usuário " + user + " no time do aprovador " + newApprover + ". Erro: " + error);

                    });

            }

        });

    });



/*
    Função acionada para novas requisições de horas adicionais (notificação)
    Mário Galvão - 20/10/2018
*/
exports.newOvertimeRequest = functions.database.ref('/companies/{company}/overtime/{user}/{year}/{month}/{day}/{request}')
    .onCreate((snapshot, context) => {

        const company = context.params.company;
        const user = context.params.user;

        return sendRequestNotification("overtime", "Horas Adicionais", company, user);

    });


/*
    Função acionada para novas solicitações de compensação de horas (notificação)
    Mário Galvão - 20/10/2018
*/
exports.newComptimeRequest = functions.database.ref('/companies/{company}/users/{user}/comptime/{year}/{month}/{day}/{request}')
    .onCreate((snapshot, context) => {

        const company = context.params.company;
        const user = context.params.user;

        return sendRequestNotification("comptime", "Compensação de Horas", company, user);

    });


/*
    Função acionada para novas solicitações de ausência remunerada (notificação)
    Mário Galvão - 20/10/2018
*/
exports.newMedicalRequest = functions.database.ref('/companies/{company}/users/{user}/medical/{year}/{month}/{day}/{request}')
    .onCreate((snapshot, context) => {

        const company = context.params.company;
        const user = context.params.user;

        return sendRequestNotification("medical", "Ausência Remunerada", company, user);

    });


/*
    Função acionada para novas solicitações de férias (notificação)
    Mário Galvão - 20/10/2018
*/
exports.newVacationRequest = functions.database.ref('/companies/{company}/users/{user}/vacation/{year}/{request}')
    .onCreate((snapshot, context) => {

        const company = context.params.company;
        const user = context.params.user;

        return sendRequestNotification("vacation", "Férias", company, user);

    });


/*
    Função para envio de notificação de nova solicitação
    Mário Galvão - 20/10/2018
*/
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


/*
    Função acionada na mudança de status das solicitações de horas adicionais (atualiza acumulado + notificação)
    Mário Galvão - 21/10/2018
*/
exports.overtimeRequestStatusDidChange = functions.database.ref('/companies/{company}/users/{user}/overtime/{year}/{month}/{day}/{request}/status')
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


/*
    Função acionada na mudança de status das solicitações de compensação de horas (atualiza acumulado + notificação)
    Mário Galvão - 21/10/2018
*/
exports.comptimeRequestStatusDidChange = functions.database.ref('/companies/{company}/users/{user}/comptime/{year}/{month}/{day}/{request}/status')
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


/*
    Função acionada na mudança de status das solicitações de ausência remunerada (atualiza acumulado + notificação)
    Mário Galvão - 21/10/2018
*/
exports.medicalRequestStatusDidChange = functions.database.ref('/companies/{company}/users/{user}/medical/{year}/{month}/{day}/{request}')
    .onUpdate((change, context) => {

        const company = context.params.company;
        const user = context.params.user;
        const newStatus = change.after.val();
        const oldStatus = change.before.val();

        return sendApprovalNotification("medical", "Ausência Remunerada", company, user, oldStatus, newStatus);

    });


/*
    Função acionada na mudança de status das solicitações de férias (atualiza acumulado + notificação)
    Mário Galvão - 21/10/2018
*/
exports.vacationRequestStatusDidChange = functions.database.ref('/companies/{company}/users/{user}/vacation/{year}/{request}')
    .onUpdate((change, context) => {

        const company = context.params.company;
        const user = context.params.user;
        const newStatus = change.after.val();
        const oldStatus = change.before.val();

        return sendApprovalNotification("vacation", "Férias", company, user, oldStatus, newStatus);

    });


/*
    Função para envio de notificação de aprovação
    Mário Galvão - 21/10/2018
*/
function sendApprovalNotification(type, typeName, company, user, oldStatus, newStatus) {

    if (oldStatus !== "Solicitado") {
        return;
    }

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


/*
    Função para atualizar o acumulado de horas adicionais
    Mário Galvão - 22/10/2018
*/
function updateOvertimeAccumulated(company, user, change, timestamp) {

    const newStatus = change.after.val();
    const oldStatus = change.before.val();

    if (oldStatus !== "Solicitado" || newStatus !== "Aprovado") {
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

        var ref2 = admin.database().ref('/companies/' + company + '/users/' + user + '/accumulated/' + index);
        ref2.once('value').then(function (snapshot) {

            var timeString = snapshot.val(); // -7

            var newTimeString = calculateTimeByAddingMinutes(timeString, minutes);

            ref2.set(newTimeString)
                .then(function (response) {

                    var zeroHour = moment("00:00", "HH:mm");
                    var diference = zeroHour.add(minutes, 'minutes');
                    diferenceString = diference.format("HH:mm");

                    var ref3 = admin.database().ref('/companies/' + company + '/users/' + user + '/accumulated/history/' + index + "/" + timestamp);
                    ref3.once('value').then(function (snapshot) {

                        var newTimeString;

                        if (snapshot.exists()) {

                            var value = snapshot.val();

                            newTimeString = calculateTimeByAddingMinutes(value, minutes);

                        } else {

                            newTimeString = diferenceString;

                        }

                        ref3.set(newTimeString)
                            .then(function (response) {

                                console.log(`Histórico. Empresa: ${company}. Usuário: ${user}. Tipo: ${type}. Histórico atualizado: ${timestamp}: ${newTimeString}.`);

                            })
                            .catch(function (error) {

                                console.log(`Histórico - Erro. Empresa: ${company}. Usuário: ${user}. Tipo: ${type}. Histórico atualizado: ${timestamp}: ${newTimeString}. Erro: ${error}.`);

                            });

                    });

                })
                .catch(function (error) {

                    console.log(`Acumulado - Erro. Empresa: ${company}. Usuário: ${user}. Tipo: ${type}. Histórico atualizado: ${timestamp}: ${diferenceString}. Erro: ${error}.`);

                });

        });

    });

}


/*
    Função para atualizar o acumulado de compensação de horas
    Mário Galvão - 22/10/2018
*/
function updateComptimeAccumulated(company, user, change, timestamp) {

    const newStatus = change.after.val();
    const oldStatus = change.before.val();

    if (oldStatus !== "Solicitado" || newStatus !== "Aprovado") {
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

        var ref2 = admin.database().ref('/companies/' + company + '/users/' + user + '/accumulated/comptime');
        ref2.once('value').then(function (snapshot) {

            var timeString = snapshot.val();
            var newTimeString = calculateTimeBySubtractingMinutes(timeString, minutes);

            ref2.set(newTimeString)
                .then(function (response) {

                    console.log(`Acumulado. Empresa: ${company}. Usuário: ${user}. Tipo: Banco (-). Minutos: ${minutes}. Acumulado anterior: ${timeString}. Novo acumulado: ${newTimeString}.`);

                    var zeroHour = moment("00:00", "HH:mm");
                    var diference = zeroHour.add(minutes, 'minutes');
                    diferenceString = diference.format("HH:mm");

                    var ref3 = admin.database().ref('/companies/' + company + '/users/' + user + '/accumulated/history/comptime/' + timestamp);
                    ref3.once('value').then(function (snapshot) {

                        var newTimeString;

                        if (snapshot.exists()) {

                            var timeString = snapshot.val();
                            newTimeString = calculateTimeBySubtractingMinutes(timeString, minutes);

                        } else {

                            newTimeString = diferenceString;

                        }

                        ref3.set(newTimeString)
                            .then(function (response) {

                                console.log(`Histórico. Empresa: ${company}. Usuário: ${user}. Tipo: Banco (-). Histórico atualizado: ${timestamp}: ${newTimeString}.`);

                            })
                            .catch(function (error) {

                                console.log(`Histórico - Erro. Empresa: ${company}. Usuário: ${user}. Tipo: Banco (-). Histórico atualizado: ${timestamp}: ${newTimeString}. Erro: ${error}.`);

                            });

                    });

                })
                .catch(function (error) {

                    console.log(`Acumulado - Erro. Empresa: ${company}. Usuário: ${user}. Tipo: Banco (-). Minutos: ${minutes}. Acumulado anterior: ${timeString}. Novo acumulado: ${newTimeString}. Erro: ${error}.`);

                });


        });

    });

}


/*
    Função para calcular a quantidade de horas acumuladas após adicionar uma quantidade de horas
    Mário Galvão - 23/10/2018
*/
function calculateTimeByAddingMinutes(timeString, minutes) {

    //    console.log(`calculateTimeByAddingMinutes`);

    var time = moment(timeString, "HH:mm"); // +7
    //    console.log(`timeString: ${timeString}, time: ${time}.`);

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
        //        console.log(`duration: ${duration}, minutes2: ${minutes2}, time: ${time}.`);

        var timeDay = time.date(); // ontem
        newTime = time.add(minutes, 'minutes'); // 18h
        var newTimeDay = newTime.date(); // ontem
        //        console.log(`timeDay: ${timeDay}, newTime: ${newTime}, newTimeDay: ${newTimeDay}.`);

        var zeroHour2 = moment("00:00", "HH:mm");
        var duration2 = moment.duration(zeroHour2.diff(newTime)); // 6h
        var minutes3 = Math.abs(duration2.asMinutes()); // 360min
        var newTime2 = zeroHour2.add(minutes3, 'minutes'); // 6h
        //        console.log(`duration2: ${duration2}, minutes2: ${minutes3}, newTime2: ${newTime2}.`);

        if (timeDay === newTimeDay) { // false

            newTimeString = `-${newTime2.format("HH:mm")}`; // -2h

        } else {

            newTimeString = newTime2.format("HH:mm"); // 2h

        }

    }

    //    console.log(`newTimeString: ${newTimeString}.`);

    return newTimeString;

}


/*
    Função para calcular a quantidade de horas acumuladas após subtrair uma quantidade de horas
    Mário Galvão - 23/10/2018
*/
function calculateTimeBySubtractingMinutes(timeString, minutes) {

    //    console.log(`calculateTimeBySubtractingMinutes`);

    var time = moment(timeString, "HH:mm");
    //    console.log(`timeString: ${timeString}, time: ${time}.`);

    var newTime;
    var newTimeString;

    if (timeString.charAt(0) === "-") {

        newTime = time.add(minutes, 'minutes');
        newTimeString = `-${newTime.format("HH:mm")}`;

    } else {

        var timeDay = time.date();
        newTime = time.subtract(minutes, 'minutes');
        var newTimeDay = newTime.date();
        //        console.log(`timeDay: ${timeDay}, newTime: ${newTime}, newTimeDay: ${newTimeDay}.`);

        if (timeString === "00:00" || timeDay !== newTimeDay) {

            var zeroHour = moment("00:00", "HH:mm");
            var duration = moment.duration(zeroHour.diff(newTime));
            var minutes2 = duration.asMinutes();
            newTime = zeroHour.add(minutes2, 'minutes');
            newTimeString = `-${newTime.format("HH:mm")}`;
            //            console.log(`duration: ${duration}, minutes2: ${minutes2}, newTime: ${newTime}.`);

        } else {

            newTimeString = newTime.format("HH:mm");

        }

    }

    //    console.log(`newTimeString: ${newTimeString}.`);

    return newTimeString;


}

/*
    Função para gerar o histórico de alterações de usuários
    Mário Galvão - 23/10/2018
*/
exports.updateUserHistory = functions.database.ref('/companies/{company}/users/{user}/status')
    .onWrite((change, context) => {

        const company = context.params.company;
        const user = context.params.user;
        const newStatus = change.after.val();
        const oldStatus = change.before.val();

        if (newStatus !== 'Ativo' && newStatus !== 'Inativo') {
            return;
        }

        // Get email
        var ref = change.after.ref.parent.child('info').child('email');
        return ref.once('value').then(function (snapshot) {

            var email = snapshot.val();

            getInitialBillingDate(company, email, newStatus);

        }).catch(function (error) {

            console.log(`Erro ao consultar e-mail do usuário: ${error}`);

        });

    });


/*
    Função para coletar os dados de billing para determinar a chave do histórico de alterações de usuários
    Mário Galvão - 24/10/2018
*/
function getInitialBillingDate(company, email, newStatus) {

    var ref = admin.database().ref().child('companies').child(company).child('billing').child('history').orderByChild('initialDate').limitToLast(1);

    return ref.once('value').then(function (snapshot) {

        if (!snapshot.exists()) {
            console.log(`billingDay não existe na empresa ${company}.`);
            return;
        }

        //        var history = snapshot.val();

        snapshot.forEach(function (childSnapshot) {

            var billingInfo = childSnapshot.val();

            var initialDate = billingInfo.initialDate;

            var initialBillingDate = moment(initialDate, 'YYYY/MM/DD').format('YYYY-MM-DD');

            return updateTotalUsers(company, initialBillingDate, email, newStatus);

        });

    }).catch(function (error) {

        console.log(`Erro ao consultar o initialDate no billing history: ${error}.`);

    });

}

/*
    Função para atualizar o total de usuários ativos atual
    Mário Galvão - 25/10/2018
*/
function updateTotalUsers(company, initialBillingDate, email, newStatus) {

    var ref = admin.database().ref().child('companies').child(company).child('usersHistory').child('totalUsers');

    return ref.once('value').then(function (snapshot) {

        if (!snapshot.exists()) {
            console.log(`totalUsers não existe na empresa ${company}.`);
            return;
        }

        var totalUsers = snapshot.val();

        if (newStatus === "Ativo") {
            totalUsers++;
        } else {
            if (totalUsers > 0) {
                totalUsers--;
            }
        }

        return ref.set(totalUsers).then(function (response) {

            console.log(`totalUsers atualizado para ${totalUsers} na empresa ${company}.`);

            return setUserHistory(company, initialBillingDate, email, newStatus, totalUsers);

        }).catch(function (error) {

            console.log(`Erro ao atualizar o totalUsers ${totalUsers} na empresa ${company}: ${error}.`);

        });

    }).catch(function (error) {

        console.log(`Erro ao consultar totalUsers na empresa ${company}: ${error}.`);

    });

}


/*
    Função para atualizar o histórico de alterações de usuários
    Mário Galvão - 26/10/2018
*/
function setUserHistory(company, initialBillingDate, email, status, totalUsers) {

    //    console.log(`company: ${company}`);
    //    console.log(`initialBillingDate: ${initialBillingDate}`);
    //    console.log(`email: ${email}`);
    //    console.log(`status: ${status}`);
    //    console.log(`totalUsers: ${totalUsers}`);

    var today = moment().format('YYYY/MM/DD');

    var values = {};
    values['date'] = today;
    values['email'] = email;
    values['status'] = status;
    values['totalUsers'] = totalUsers;

    var ref = admin.database().ref().child('companies').child(company).child('usersHistory').child(initialBillingDate).push();

    return ref.update(values).then(function (response) {

        console.log(`usersHistory atualizado na empresa ${company}: \nData: ${today} \nEmail: ${email} \nStatus: ${status} \nTotalUsers: ${totalUsers}`);

    }).catch(function (error) {

        console.log(`Erro ao atualizar usersHistory na empresa ${company}.`);

    });

}


/*
    Função para processar o pagamento mensal
    Mário Galvão - 28/10/2018
*/

exports.billing = functions.https.onRequest((req, res) => {

    var yesterday = moment().subtract(1, 'day').format('YYYY/MM/DD');

    var ref = admin.database().ref().child('billing').orderByChild('finalDate').equalTo(yesterday);

    return ref.once('value').then(function (snapshot) {

        if (!snapshot.exists()) {
            console.log(`Não há empresas para processamento de billing nessa data.`);
            res.writeHead(200);
            res.end();
            return;
        }

        var numChildren = snapshot.numChildren();
        var i = 0;

        snapshot.forEach(function (childSnapshot) {

            i++;

            var billingKey = childSnapshot.key;

            //            console.log(`historyKey: ${historyKey}.`);

            var billingInfo = childSnapshot.val();

            var finalDate = billingInfo.finalDate;
            var initialDate = billingInfo.initialDate;
            var company = billingInfo.company;
            var paymentStatus = billingInfo.paymentStatus;

            if (paymentStatus === 'Em aberto') {

                return getCompanyTotalUsers(company, billingKey, initialDate, finalDate, (i === numChildren), res);

            } else {

                console.log(`Empresa ${company} sem paymentStatus elegível para processamento de billing: ${paymentStatus}.`);

                if (i === numChildren) {
                    console.log(`Billing de todas as empresas processado com sucesso.`);
                    res.writeHead(200);
                    res.end();
                }

            }

        });

    }).catch(function (error) {

        console.log(`Erro ao consultar billingDate em billing. Nenhuma empresa terá o billing processado.`);

        res.writeHead(400);
        res.end();

    });


    //    res.writeHead(200);
    //    res.end();

});


/*
    Função para coletar o máximo de usuários ativos no período do ciclo de faturamento
    Mário Galvão - 01/11/2018 
*/
function getCompanyTotalUsers(company, billingKey, initialDate, finalDate, isLast, res) {

    //    console.log(`Entrou no getCompanyTotalUsers para empresa ${company}.`);

    var initialDate2 = moment(initialDate, 'YYYY/MM/DD');
    var usersHistoryKey = initialDate2.format('YYYY-MM-DD');

    var ref = admin.database().ref().child('companies').child(company).child('usersHistory').child(usersHistoryKey);

    return ref.once('value').then(function (snapshot) {

        if (!snapshot.exists()) {
            console.log(`Não houve alterações de usuários ativos na empresa ${company} neste ciclo de faturamento`);

            var ref2 = admin.database().ref().child('companies').child(company).child('usersHistory').child('totalUsers');
            return ref2.once('value').then(function (snapshot) {

                var totalUsers = snapshot.val();

                //                return getCompanyBillingHistoryInfo(company, billingKey, totalUsers, isLast, res);
                return getCompanyBillingInfo(company, billingKey, totalUsers, isLast, res);

            }).catch(function (error) {

                console.log(`Erro ao consultar totalUsers da empresa ${company}.`);

                res.writeHead(400);
                res.end();

            });

        } else {

            var history = snapshot.val();
            var historyKeys = Object.keys(history);

            var maxUsers = 0;

            var i;
            for (i = 0; i < historyKeys.length; i++) {

                var key = historyKeys[i];
                var totalUsers = history[key].totalUsers;
                if (totalUsers > maxUsers) {
                    maxUsers = totalUsers;
                }

            }

            //            return getCompanyBillingHistoryInfo(company, billingKey, maxUsers, isLast, res);
            return getCompanyBillingInfo(company, billingKey, maxUsers, isLast, res);

        }

    }).catch(function (error) {

        console.log(`Erro ao consultar usersHistory da empresa ${company}.`);

        res.writeHead(400);
        res.end();

    });

}


/*
    Função para coletar todos os dados de faturamento necessários da empresa
    Mário Galvão - 22/11/2018 
*/
function getCompanyBillingInfo(company, billingKey, totalUsers, isLast, res) {

    //    console.log(`Entrou no getCompanyBillingInfo para empresa ${company}.`);

    var ref = admin.database().ref().child('companies').child(company).child('billing');

    ref.once('value').then(function (snapshot) {

        if (!snapshot.exists()) {
            console.log(`Não há registro de billing na empresa ${company}.`);
            return;
        }

        var billing = snapshot.val();

        var creditCard = billing.creditCard;
        var address = billing.address;
        var history = billing.history;
        var status = billing.status;

        console.log(`Dados coletados com sucesso para processar o pagamento na empresa ${company}, para a chave ${billingKey}.`);

        //        paymentPayU(company, billingKey, totalPrice, billing, isLast, res);

        var isCreditCardValidated = false;
        if (creditCard) {
            //            console.log(`Entrou no if do creditCard`);
            isCreditCardValidated = creditCard.isValidated || false;
        }

        var isAddressValidated = false;
        if (address) {
            //            console.log(`Entrou no if do address`);
            isAddressValidated = address.isValidated || false;
        }

        if (history) {

            //            console.log(`Entrou no if do history`);

            var lastBillingHistory = history[billingKey];

            var initialDateString = lastBillingHistory.initialDate;
            //            console.log(`initialDateString: ${initialDateString}`);
            var initialDate = moment(initialDateString, 'YYYY/MM/DD');
            var finalDateString = lastBillingHistory.finalDate;
            //            console.log(`finalDateString: ${finalDateString}`);
            var finalDate = moment(finalDateString, 'YYYY/MM/DD');
            var plan = lastBillingHistory.plan;
            //            console.log(`plan: ${plan}`);
            var minUsers = lastBillingHistory.minUsers;
            //            console.log(`minUsers: ${minUsers}`);
            var unitPrice = lastBillingHistory.unitPrice;
            //            console.log(`unitPrice: ${unitPrice}`);
            var paymentStatus = lastBillingHistory.paymentStatus;
            //            console.log(`paymentStatus: ${paymentStatus}`);
            var fullMonth = lastBillingHistory.fullMonth;
            //            console.log(`fullMonth: ${fullMonth}`);
            var totalPrice = calculateTotalPrice(plan, minUsers, unitPrice, totalUsers, fullMonth, paymentStatus, initialDate, finalDate);
            //            console.log(`totalPrice: ${totalPrice}`);

            console.log(`Dados de billing coletados. initialDateString: ${initialDateString}, finalDateString: ${finalDateString}, plan: ${plan}, minUsers: ${minUsers}, minUsers: ${minUsers}, unitPrice: ${unitPrice}, paymentStatus: ${paymentStatus}, fullMonth: ${fullMonth}, totalPrice: ${totalPrice}.`);

            updateCompanyBillingInfo(company, billingKey, totalUsers, totalPrice, isLast, res);

            if (isCreditCardValidated && isAddressValidated) {

                var nextInitialDate = finalDate.add(1, 'day').format('YYYY/MM/DD');
                var nextFinalDate = moment(nextInitialDate, 'YYYY/MM/DD').add(1, 'month').subtract(1, 'day').format('YYYY/MM/DD');

                //                console.log(`nextInitialDate: ${nextInitialDate}`);
                //                console.log(`nextFinalDate: ${nextFinalDate}`);

                setNextCompanyBillingInfo(company, plan, minUsers, unitPrice, nextInitialDate, nextFinalDate);

                if (totalPrice > 0) {
                    paymentPayU(company, billingKey, totalPrice, billing, isLast, res);
                }

            } else {

                if (status === 'Ativo') {

                    cancelSignature(company, isLast, res);

                } else {

                    if (isLast) {
                        res.writeHead(200);
                        res.end();
                    }

                }

            }

        }

    }).catch(function (error) {

        console.log(`Erro ao consultar billing da empresa ${company}. Erro: ${error}.`);

        res.writeHead(400);
        res.end();

    });

}


/*
    Função para calcular o preço total nos diversos casos
    Mário Galvão - 23/11/2018 
*/
function calculateTotalPrice(plan, minUsers, unitPrice, totalUsers, fullMonth, paymentStatus, initialDate, finalDate) {

    //    console.log(`Entrou no calculateTotalPrice`);

    if (plan === 'Gratuito') {
        return 0;
    }

    var users = totalUsers;

    if (minUsers > totalUsers) {
        users = minUsers;
    }

    if (paymentStatus === 'Em aberto' && fullMonth) {

        return users * unitPrice;

    } else if (paymentStatus === 'Em aberto' && !fullMonth) {

        var duration = moment.duration(finalDate.diff(initialDate));
        var days = Math.abs(duration.asDays());

        return users * unitPrice / 30 * days + 1;

    } else {

        console.log(`Empresa ${company} não possui informações elegíveis para processar o billing na chave ${billingKey}.`);
        return 0;

    }

}


/*
    Função para cancelar a assinatura de empresas que não informaram dados para o pagamento e acabou o período gratuito
    Mário Galvão - 24/11/2018 
*/
function cancelSignature(company, isLast, res) {

    //    console.log(`Entrou no cancelSignature`);

    var status = 'Inativo';

    var ref = admin.database().ref();

    var values = {};
    values[`companies/${company}/billing/status`] = status;
    values[`freeCompanies/${company}/status`] = status;

    return ref.update(values).then(function (response) {

        console.log(`Status alterado para ${status} na empresa ${company}.`);

        if (isLast) {
            res.writeHead(200);
            res.end();
        }

    }).catch(function (error) {

        console.log(`Erro ao atualizar status na empresa ${company}. Erro: ${error}.`);

        res.writeHead(400);
        res.end();

    });

}


/*
    Função para atualizar o total de usuários e preço total do billing
    Mário Galvão - 25/11/2018 
*/
function updateCompanyBillingInfo(company, billingKey, totalUsers, totalPrice) {

    var paymentStatus = 'Em processamento';

    if (totalPrice === 0) {
        paymentStatus = 'Gratuito';
    }

    var ref = admin.database().ref();

    var values = {};
    values[`companies/${company}/billing/history/${billingKey}/totalUsers`] = totalUsers;
    values[`companies/${company}/billing/history/${billingKey}/totalPrice`] = totalPrice;
    values[`companies/${company}/billing/history/${billingKey}/paymentStatus`] = paymentStatus;
    values[`billing/${billingKey}/paymentStatus`] = paymentStatus;

    return ref.update(values).then(function (response) {

        console.log(`totalUsers e totalPrice atualizados com sucesso na empresa ${company} chave ${billingKey}`);

    }).catch(function (error) {

        console.log(`Erro ao atualizar billing da empresa ${company} na chave ${billingKey}. Erro: ${error}.`);

        res.writeHead(400);
        res.end();

    });

}


/*
    Função para setar os dados do próximo período de billing
    Mário Galvão - 11/11/2018 
*/
function setNextCompanyBillingInfo(company, plan, minUsers, unitPrice, initialDate, finalDate) {

    var ref = admin.database().ref().child('billing').push();

    var billingKey = ref.getKey();

    var values = {};
    values[`billing/${billingKey}/company`] = company;
    values[`billing/${billingKey}/initialDate`] = initialDate;
    values[`billing/${billingKey}/finalDate`] = finalDate;
    values[`billing/${billingKey}/paymentStatus`] = 'Em aberto';
    values[`companies/${company}/billing/history/${billingKey}/initialDate`] = initialDate;
    values[`companies/${company}/billing/history/${billingKey}/finalDate`] = finalDate;
    values[`companies/${company}/billing/history/${billingKey}/plan`] = plan;
    values[`companies/${company}/billing/history/${billingKey}/minUsers`] = minUsers;
    values[`companies/${company}/billing/history/${billingKey}/unitPrice`] = unitPrice;
    values[`companies/${company}/billing/history/${billingKey}/totalUsers`] = '-';
    values[`companies/${company}/billing/history/${billingKey}/totalPrice`] = '-';
    values[`companies/${company}/billing/history/${billingKey}/paymentStatus`] = 'Em aberto';
    values[`companies/${company}/billing/history/${billingKey}/fullMonth`] = true;

    var ref2 = admin.database().ref();

    ref2.update(values).then(function (response) {

        console.log(`Foram registrados os dados de billing para o próximo ciclo da empresa ${company}.`);

    }).catch(function (error) {

        console.log(`Erro ao gerar o registro de billing fora da empresa para o próximo ciclo da empresa ${company}. Erro: ${error}.`);

    });

}



/*
    Função para processar o pagamento na PayU
    Mário Galvão - 15/11/2018 
*/
function paymentPayU(company, billingKey, totalPrice, billing, isLast, res) {

    //    console.log(`Entrou em paymentPayU`);

    // Ambiente de Testes
    var apiLogin = "pRRXKOl8ikMmt9u";
    var apiKey = "4Vj8eK4rloUd272L48hsrarnUA";
    //        static var publicKey = "???"
    var merchantId = "508029";
    var accountId = "512327"; // Verificar outra conta para o Onclock

    var consultLink = "https://sandbox.api.payulatam.com/reports-api/4.0/service.cgi";
    var paymentLink = "https://sandbox.api.payulatam.com/payments-api/4.0/service.cgi";
    var pricingLink = "https://sandbox.api.payulatam.com/payments-api/rest/v4.3/pricing";

    var notifyUrl = "https://us-central1-ponto-dev-b87a2.cloudfunctions.net/payu";


    // Outras informações para a PayU
    var timestamp = moment().format('YYYYMMDDhhmmss');
    var referenceCode = `${billingKey}.${timestamp}`;
    var currency = 'BRL';
    var description = company;
    var formatter = new Intl.NumberFormat('pt-BR', {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
    });
    var price = formatter.format(totalPrice);
    var signature = md5(apiKey + "~" + merchantId + "~" + referenceCode + "~" + price + "~" + currency);

    // Cartão de crédito
    var creditCard = billing.creditCard;
    var brand = CryptoJS.AES.decrypt(creditCard.brand, company).toString(CryptoJS.enc.Utf8);
    //    var number = CryptoJS.AES.decrypt(creditCard.number, company).toString(CryptoJS.enc.Utf8);
    //    var expiration = CryptoJS.AES.decrypt(creditCard.expiration, company).toString(CryptoJS.enc.Utf8);
    //    var cvv = CryptoJS.AES.decrypt(creditCard.cvv, company).toString(CryptoJS.enc.Utf8);
    var tokenId = CryptoJS.AES.decrypt(creditCard.tokenId, company).toString(CryptoJS.enc.Utf8);
    var name = CryptoJS.AES.decrypt(creditCard.name, company).toString(CryptoJS.enc.Utf8);
    var fiscalID = CryptoJS.AES.decrypt(creditCard.fiscalID, company).toString(CryptoJS.enc.Utf8);
    var phone = CryptoJS.AES.decrypt(creditCard.phone, company).toString(CryptoJS.enc.Utf8);
    phone = unMask(phone);
    var email = CryptoJS.AES.decrypt(creditCard.email, company).toString(CryptoJS.enc.Utf8);
    var cpf = '';
    var cnpj = '';
    if (fiscalID.length > 14) {
        cnpj = unMask(fiscalID);
    } else {
        cpf = fiscalID;
    }

    // Endereço
    var address = billing.address;
    var city = address.city;
    var complement = address.complement;
    var country = address.country;
    var neighborhood = address.neighborhood;
    var nr = address.number;
    var state = address.state;
    var street = address.street;
    var zipcode = address.zipcode;
    zipcode = unMask(zipcode);

    var body = {
        "language": "pt",
        "command": "SUBMIT_TRANSACTION",
        "merchant": {
            "apiLogin": apiLogin,
            "apiKey": apiKey
        },
        "transaction": {
            "order": {
                "accountId": accountId,
                "referenceCode": referenceCode,
                "description": description,
                "language": "pt",
                "notifyUrl": notifyUrl,
                "signature": signature,
                "additionalValues": {
                    "TX_VALUE": {
                        "value": price,
                        "currency": "BRL"
                    }
                },
                "buyer": {
                    "merchantBuyerId": company,
                    "fullName": name,
                    "emailAddress": email,
                    "dniNumber": cpf,
                    "cnpj": cnpj,
                    "contactPhone": phone,
                    "shippingAddress": {
                        "street1": `${street}, ${nr}, ${complement}`,
                        "street2": neighborhood,
                        "city": city,
                        "state": state,
                        "country": "BR",
                        "postalCode": zipcode,
                        "phone": phone
                    }
                }
            },
            "creditCardTokenId": tokenId,
            //            "creditCard": {
            //                "securityCode": cvv
            //            },
            "extraParameters": {
                "INSTALLMENTS_NUMBER": 1,
            },
            "type": "AUTHORIZATION_AND_CAPTURE",
            "paymentMethod": brand,
            "paymentCountry": "BR",
            "ipAddress": "127.0.0.1"
        },
        "test": "true" // Alterar para false somente quando for para produção
    };

    var stringArray = JSON.stringify(body);
    console.log(`stringArray: ${stringArray}`);

    var request = {
        headers: {
            "Content-Type": "application/json",
            "Accept": "application/json"
        },
        body: stringArray,
        method: "POST"
    };

    fetch(paymentLink, request)
        .then(function (response) {

            if (response.status >= 400) {
                throw new Error(`Erro na resposta do servidor da PayU: ${response.status}.`);
            }
            return response.json();

        }).then(function (stories) {

            var storiesString = JSON.stringify(stories);
            console.log(`Processamento do pagamento finalizado na empresa ${company} para a chave ${billingKey}. Stories: ${storiesString}.`);

            paymentCheckResponse(company, billingKey, stories);

            if (isLast) {
                console.log(`Todos os pagamentos foram processados com sucesso.`);
                res.writeHead(200);
                res.end();
            }

        }).catch(function (error) {

            console.log(`Erro ao processar pagamento na empresa ${company} para a chave ${billingKey}. Erro: ${error}.`);

            paymentCheckResponse(company, billingKey, stories);

            res.writeHead(400);
            res.end();

        });

}


/*
    Função para remover a máscara de strings
    Mário Galvão - 12/11/2018 
*/
function unMask(text) {

    var newText = text;
    newText = newText.replace(/\s/g, "");
    newText = newText.replace("(", "");
    newText = newText.replace(")", "");
    newText = newText.replace("-", "");
    newText = newText.replace(".", "");
    newText = newText.replace("/", "");

    return newText;

}


/*
    Função para processar a resposta do pagamento da PayU
    Mário Galvão - 16/11/2018 
*/
function paymentCheckResponse(company, billingKey, stories) {

    var code = stories["code"];
    var error = stories["error"];

    if (code === "ERROR") {

        updateBillingStatus(company, billingKey, 'Reprovado', 'Erro', error, '', '');

    } else if (code === "SUCCESS") {

        var transactionResponse = stories["transactionResponse"];
        var state = transactionResponse["state"];
        var message = transactionResponse["responseMessage"] || '';
        var orderId = transactionResponse["orderId"] || '';
        var transactionId = transactionResponse["transactionId"] || '';

        switch (state) {

            case "APPROVED":

                updateBillingStatus(company, billingKey, 'Aprovado', state, message, orderId, transactionId);
                break;

            case "DECLINED":

                updateBillingStatus(company, billingKey, 'Reprovado', state, message, orderId, transactionId);
                break;

            case "ERROR":

                updateBillingStatus(company, billingKey, 'Erro', state, message, orderId, transactionId);
                break;

            case "EXPIRED":

                updateBillingStatus(company, billingKey, 'Expirado', state, message, orderId, transactionId);
                break;

            case "PENDING":

                updateBillingStatus(company, billingKey, 'Em análise', state, message, orderId, transactionId);
                break;

            default:

                console.log(`State ${state} não identificado na resposta da PayU para empresa ${company}, chave ${billingKey}.`);
                break;

        }

    }

}


/*
    Função para atualizar o resultado do processamento do pagamento na base de dados
    Mário Galvão - 25/11/2018 
*/
function updateBillingStatus(company, billingKey, paymentStatus, responseState, responseMessage, orderId, transactionId) {

    var ref = admin.database().ref();

    var values = {};
    values[`billing/${billingKey}/paymentStatus`] = paymentStatus;
    values[`companies/${company}/billing/history/${billingKey}/paymentStatus`] = paymentStatus;
    values[`companies/${company}/billing/history/${billingKey}/responseState`] = responseState;
    values[`companies/${company}/billing/history/${billingKey}/responseMessage`] = responseMessage;
    values[`companies/${company}/billing/history/${billingKey}/orderId`] = orderId;
    values[`companies/${company}/billing/history/${billingKey}/transactionId`] = transactionId;

    ref.update(values).then(function (response) {

        console.log(`Dados de pagamento atualizados com sucesso para a empresa ${company} na chave ${billingKey}.`);

    }).catch(function (error) {

        console.log(`Erro ao atualizar dados de pagamento para a empresa ${company} na chave ${billingKey}. Erro: ${error}.`);

    });

}



/*
    Função para receber o POST de notificação da PayU, com os dados sobre o processamento do pagamento
    Mário Galvão - 18/11/2018 
*/
exports.payu = functions.https.onRequest((req, res) => {

    //    console.log("URL: " + req.baseUrl);
    //    console.log("Method: " + req.method);

    switch (req.method) {

        case "GET":

            getData(req, res);

            break;

        case "POST":

            console.log("PayU - POST URL de Notificação: " + JSON.stringify(req.body));

            postData(req, res, req.body);

            break;

        default:
            break;

    }


});


/*
    Função para verificar os dados recebidos pelo POST de notificação da PayU e atualizar o status na base de dados
    Mário Galvão - 18/11/2018 
*/
function postData(req, resp, data) {

    // Pegar dados do pedido

    // Testes
    var api_key = "4Vj8eK4rloUd272L48hsrarnUA";
    // Produção
    // var api_key = "f3PV2MC6776zydnsgBAB5vPj7s";

    var merchant_id = data.merchant_id;
    var reference_sale = data.reference_sale;
    var value = data.value;
    var currency = data.currency;
    var state_pol = data.state_pol;
    //    var referenceCode = data.referenceCode;
    var referenceSaleSplited = reference_sale.split('.');
    var billingKey = referenceSaleSplited[0];
    var timestamp = referenceSaleSplited[1];
    var company = data.description;

    //    if ((value[value.length - 2] === "0") && (value[value.length - 1] === "0")) {
    if (value[value.length - 1] === "0") {
        console.log("Valor terminado em zero, último dígito removido.");
        value = value.substring(0, value.length - 1);
    }

    var sign = md5(api_key + "~" + merchant_id + "~" + reference_sale + "~" + value + "~" + currency + "~" + state_pol);

    //    console.log("api_key: " + api_key);
    //    console.log("merchant_id: " + merchant_id);
    //    console.log("reference_sale: " + reference_sale);
    //    console.log("value: " + value);
    //    console.log("currency: " + currency);
    //    console.log("state_pol: " + state_pol);
    //    //    console.log("referenceCode: " + referenceCode);
    //    console.log("billingKey: " + billingKey);
    //    console.log("timestamp: " + timestamp);
    //    console.log("company: " + company);
    //    console.log("sign: " + sign);

    if (String(data.sign) !== String(sign)) {

        //        console.log("Assinatura não confere: " + String(data.sign));
        console.log(`Assinatura não confere. \ndata.sign: ${data.sign} \nsign: ${sign}`);
        //        console.log(`sign: ${sign}`);

        resp.writeHead(400);
        resp.end();

        return;

    }

    var status = "";

    switch (state_pol) {

        case "4":

            status = "Aprovado";
            break;

        case "5":

            status = "Expirado";
            break;

        case "6":

            status = "Reprovado";
            break;

        default:

            console.log(`state_pol ${state_pol} não identificado na URL de notificação.`);
            status = "Em processamento";
            break;

    }

    console.log("Status do pagamento: " + status);

    var values = {};
    values[`billing/${billingKey}/paymentStatus`] = status;
    values[`companies/${company}/billing/history/${billingKey}/paymentStatus`] = status;

    var ref = admin.database().ref();

    ref.update(values).then(function (response) {

        console.log(`Status do billing com chave ${billingKey} da empresa ${company} alterado para ${status}.`);

        resp.writeHead(200);
        resp.end();

    }).catch(function (error) {

        console.log(`Erro ao alterar o status do billing com chave ${billingKey} da empresa ${company} para ${status}.`);

        resp.writeHead(400);
        resp.end();

    });

}


/*
    Função para gerar uma página HTML de teste para a notificação da PayU
    Mário Galvão - 16/11/2018 
*/
function getData(req, res) {

    res.status(200).send(`

<html>
 <body>
     <form method='post'>
         <table>
             <tr>
                 <td>merchant_id</td>
                 <td><input type='text' id='merchant_id' name='merchant_id' value='508029' /></td>
             </tr>
             <tr>
                 <td>state_pol</td>
                 <td><input type='text' id='state_pol' name='state_pol' value='4' /></td>
             </tr>
             <tr>
                 <td>risk</td>
                 <td><input type='text' id='risk' name='risk' value='' /></td>
             </tr>
             <tr>
                 <td>response_code_pol</td>
                 <td><input type='text' id='response_code_pol' name='response_code_pol' value='' /></td>
             </tr>
             <tr>
                 <td>reference_sale</td>
                 <td><input type='text' id='reference_sale' name='reference_sale' value='1002219884865' /></td>
             </tr>
             <tr>
                 <td>reference_pol</td>
                 <td><input type='text' id='reference_pol' name='reference_pol' value='' /></td>
             </tr>
             <tr>
                 <td>sign</td>
                 <td><input type='text' id='sign' name='sign' value='48d5008e7b949c259bc7d5e96fb105e2' /></td>
             </tr>
             <tr>
                 <td>extra1</td>
                 <td><input type='text' id='extra1' name='extra1' value='' /></td>
             </tr>
             <tr>
                 <td>extra2</td>
                 <td><input type='text' id='extra2' name='extra2' value='' /></td>
             </tr>
             <tr>
                 <td>payment_method</td>
                 <td><input type='text' id='payment_method' name='payment_method' value='' /></td>
             </tr>
             <tr>
                 <td>payment_method_type</td>
                 <td><input type='text' id='payment_method_type' name='payment_method_type' value='' /></td>
             </tr>
             <tr>
                 <td>installments_number</td>
                 <td><input type='text' id='installments_number' name='installments_number' value='' /></td>
             </tr>
             <tr>
                 <td>value</td>
                 <td><input type='text' id='value' name='value' value='15.00' /></td>
             </tr>
             <tr>
                 <td>tax</td>
                 <td><input type='text' id='tax' name='tax' value='' /></td>
             </tr>
             <tr>
                 <td>additional_value</td>
                 <td><input type='text' id='additional_value' name='additional_value' value='' /></td>
             </tr>
             <tr>
                 <td>transaction_date</td>
                 <td><input type='text' id='transaction_date' name='transaction_date' value='' /></td>
             </tr>
             <tr>
                 <td>currency</td>
                 <td><input type='text' id='currency' name='currency' value='BRL' /></td>
             </tr>
             <tr>
                 <td>email_buyer</td>
                 <td><input type='text' id='email_buyer' name='email_buyer' value='' /></td>
             </tr>
             <tr>
                 <td>cus</td>
                 <td><input type='text' id='cus' name='cus' value='' /></td>
             </tr>
             <tr>
                 <td>pse_bank</td>
                 <td><input type='text' id='pse_bank' name='pse_bank' value='' /></td>
             </tr>
             <tr>
                 <td>test</td>
                 <td><input type='text' id='test' name='test' value='' /></td>
             </tr>
             <tr>
                 <td>description</td>
                 <td><input type='text' id='description' name='description' value='1002219884865' /></td>
             </tr>
             <tr>
                 <td>billing_address</td>
                 <td><input type='text' id='billing_address' name='billing_address' value='' /></td>
             </tr>
             <tr>
                 <td>shipping_address</td>
                 <td><input type='text' id='shipping_address' name='shipping_address' value='' /></td>
             </tr>
             <tr>
                 <td>phone</td>
                 <td><input type='text' id='phone' name='phone' value='' /></td>
             </tr>
             <tr>
                 <td>office_phone</td>
                 <td><input type='text' id='office_phone' name='office_phone' value='' /></td>
             </tr>
             <tr>
                 <td>account_number_ach</td>
                 <td><input type='text' id='account_number_ach' name='account_number_ach' value='' /></td>
             </tr>
             <tr>
                 <td>account_type_ach</td>
                 <td><input type='text' id='account_type_ach' name='account_type_ach' value='' /></td>
             </tr>
             <tr>
                 <td>administrative_fee</td>
                 <td><input type='text' id='administrative_fee' name='administrative_fee' value='' /></td>
             </tr>
             <tr>
                 <td>administrative_fee_base</td>
                 <td><input type='text' id='administrative_fee_base' name='administrative_fee_base' value='' /></td>
             </tr>
             <tr>
                 <td>administrative_fee_tax</td>
                 <td><input type='text' id='administrative_fee_tax' name='administrative_fee_tax' value='' /></td>
             </tr>
             <tr>
                 <td>airline_code</td>
                 <td><input type='text' id='airline_code' name='airline_code' value='' /></td>
             </tr>
             <tr>
                 <td>attempts</td>
                 <td><input type='text' id='attempts' name='attempts' value='' /></td>
             </tr>
             <tr>
                 <td>authorization_code</td>
                 <td><input type='text' id='authorization_code' name='authorization_code' value='' /></td>
             </tr>
             <tr>
                 <td>bank_id</td>
                 <td><input type='text' id='bank_id' name='bank_id' value='' /></td>
             </tr>
             <tr>
                 <td>billing_city</td>
                 <td><input type='text' id='billing_city' name='billing_city' value='' /></td>
             </tr>
             <tr>
                 <td>billing_country</td>
                 <td><input type='text' id='billing_country' name='billing_country' value='' /></td>
             </tr>
             <tr>
                 <td>commision_pol</td>
                 <td><input type='text' id='commision_pol' name='commision_pol' value='' /></td>
             </tr>
             <tr>
                 <td>commision_pol_currency</td>
                 <td><input type='text' id='commision_pol_currency' name='commision_pol_currency' value='' /></td>
             </tr>
             <tr>
                 <td>customer_number</td>
                 <td><input type='text' id='customer_number' name='customer_number' value='' /></td>
             </tr>
             <tr>
                 <td>date</td>
                 <td><input type='text' id='date' name='date' value='' /></td>
             </tr>
             <tr>
                 <td>error_code_bank</td>
                 <td><input type='text' id='error_code_bank' name='error_code_bank' value='' /></td>
             </tr>
             <tr>
                 <td>error_message_bank</td>
                 <td><input type='text' id='error_message_bank' name='error_message_bank' value='' /></td>
             </tr>
             <tr>
                 <td>exchange_rate</td>
                 <td><input type='text' id='exchange_rate' name='exchange_rate' value='' /></td>
             </tr>
             <tr>
                 <td>ip</td>
                 <td><input type='text' id='ip' name='ip' value='' /></td>
             </tr>
             <tr>
                 <td>nickname_buyer</td>
                 <td><input type='text' id='nickname_buyer' name='nickname_buyer' value='' /></td>
             </tr>
             <tr>
                 <td>nickname_seller</td>
                 <td><input type='text' id='nickname_seller' name='nickname_seller' value='' /></td>
             </tr>
             <tr>
                 <td>payment_method_id</td>
                 <td><input type='text' id='payment_method_id' name='payment_method_id' value='' /></td>
             </tr>
             <tr>
                 <td>payment_request_state</td>
                 <td><input type='text' id='payment_request_state' name='payment_request_state' value='' /></td>
             </tr>
             <tr>
                 <td>pseReference1</td>
                 <td><input type='text' id='pseReference1' name='pseReference1' value='' /></td>
             </tr>
             <tr>
                 <td>pseReference2</td>
                 <td><input type='text' id='pseReference2' name='pseReference2' value='' /></td>
             </tr>
             <tr>
                 <td>pseReference3</td>
                 <td><input type='text' id='pseReference3' name='pseReference3' value='' /></td>
             </tr>
             <tr>
                 <td>response_message_pol</td>
                 <td><input type='text' id='response_message_pol' name='response_message_pol' value='' /></td>
             </tr>
             <tr>
                 <td>shipping_city</td>
                 <td><input type='text' id='shipping_city' name='shipping_city' value='' /></td>
             </tr>
             <tr>
                 <td>shipping_country</td>
                 <td><input type='text' id='shipping_country' name='shipping_country' value='' /></td>
             </tr>
             <tr>
                 <td>transaction_bank_id</td>
                 <td><input type='text' id='transaction_bank_id' name='transaction_bank_id' value='' /></td>
             </tr>
             <tr>
                 <td>transaction_id</td>
                 <td><input type='text' id='transaction_id' name='transaction_id' value='' /></td>
             </tr>
             <tr>
                 <td>payment_method_name</td>
                 <td><input type='text' id='payment_method_name' name='payment_method_name' value='' /></td>
             </tr>
             <tr>
                 <td><input type='submit' value='Post' /></td>
             </tr>
         </table>
     </form>
 </body>
</html>

    `);

}


/*
    Função para receber o POST de notificação de promoção via SendInBlue
    Mário Galvão - 23/11/2018 
*/
exports.sendInBlueWebhook = functions.https.onRequest((req, res) => {

    //    console.log("URL: " + req.baseUrl);
    //    console.log("Method: " + req.method);

    switch (req.method) {

        case "GET":

            console.log(`SendInBlue GET Webhook não implementado.`);

            break;

        case "POST":

            console.log("SendInBlue POST Webhook: " + JSON.stringify(req.body));

            sendInBlueDiscount(req.body);

            break;

        default:
            break;

    }


});


/*
    Função para atualizar os dados do POST de notificação de promoção via SendInBlue na base de dados da empresa
    Mário Galvão - 23/11/2018 
*/
function sendInBlueDiscount(data) {

    var attributes = data["attributes"];

    if (attributes) {

        var name = attributes["NOME"];
        var isCreditCardValidated = attributes["CREDITCARDISVALIDATED"];
        var isAddressValidated = attributes["ADDRESSISVALIDATED"];
        var freeDays = attributes["FREEDAYS"];
        var company = attributes["COMPANY"];
        var discount = attributes["DISCOUNT"];
        var email = attributes["EMAIL"];
        var expiration = moment().add(5, 'days').format('DD/MM/YYYY');

        var ref = admin.database().ref();

        var values = {};
        values[`companies/${company}/billing/discount/percentage`] = discount;
        values[`companies/${company}/billing/discount/expiration`] = expiration;

        ref.update(values).then(function (response) {

            console.log(`Dados de promoção atualizados com sucesso para a empresa ${company}. Desconto de ${discount}% valido até ${expiration}.`);

        }).catch(function (error) {

            console.log(`Erro ao atualizar dados de promoção para a empresa ${company}. Erro: ${error}.`);

        });

    } else {

        console.log(`attributes não identificado no body`);

    }

}
