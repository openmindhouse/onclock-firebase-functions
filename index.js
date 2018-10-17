const functions = require('firebase-functions');
const admin = require('firebase-admin');
var moment = require('moment');

admin.initializeApp(functions.config().firebase);


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



exports.newOvertimeRequest = functions.database.ref('/companies/{company}/users/{user}/overtime/{year}/{month}/{day}/{request}')
    .onCreate((snapshot, context) => {

        const company = context.params.company;
        const user = context.params.user;

        return sendRequestNotification("overtime", "Horas Adicionais", company, user);

    });

exports.newComptimeRequest = functions.database.ref('/companies/{company}/users/{user}/comptime/{year}/{month}/{day}/{request}')
    .onCreate((snapshot, context) => {

        const company = context.params.company;
        const user = context.params.user;

        return sendRequestNotification("comptime", "Compensação de Horas", company, user);

    });

exports.newMedicalRequest = functions.database.ref('/companies/{company}/users/{user}/medical/{year}/{month}/{day}/{request}')
    .onCreate((snapshot, context) => {

        const company = context.params.company;
        const user = context.params.user;

        return sendRequestNotification("medical", "Ausência Remunerada", company, user);

    });

exports.newVacationRequest = functions.database.ref('/companies/{company}/users/{user}/vacation/{year}/{request}')
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

exports.medicalRequestStatusDidChange = functions.database.ref('/companies/{company}/users/{user}/medical/{year}/{month}/{day}/{request}')
    .onUpdate((change, context) => {

        const company = context.params.company;
        const user = context.params.user;
        const newStatus = change.after.val();
        const oldStatus = change.before.val();

        return sendApprovalNotification("medical", "Ausência Remunerada", company, user, oldStatus, newStatus);

    });

exports.vacationRequestStatusDidChange = functions.database.ref('/companies/{company}/users/{user}/vacation/{year}/{request}')
    .onUpdate((change, context) => {

        const company = context.params.company;
        const user = context.params.user;
        const newStatus = change.after.val();
        const oldStatus = change.before.val();

        return sendApprovalNotification("vacation", "Férias", company, user, oldStatus, newStatus);

    });


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
