$(function() {
  const socketMsg = require('./constants.js');
  var Map = require('./map.js');
  
  var socket = io();
  
  var map = new Map(function() {
    socket.emit(socketMsg.requestStops);
    socket.emit(socketMsg.requestEdges);
  });
  
  socket.on(socketMsg.log, function(msg) {
    console.log(msg);
  });
  
  socket.on(socketMsg.sendStops, function(stopsGeoJson) {
    map.addStops(stopsGeoJson);
  });
  
  socket.on(socketMsg.sendEdges, function(edges) {
    map.addEdges(edges);
  });
  
  socket.on(socketMsg.event, function(event) {
    console.log(event);
    if (event.type === socketMsg.visitNode) {
      map.visitEdge(event.data);
    } else if (event.type === socketMsg.leaveNode) {
      map.leaveEdge(event.data);
    } else {
      throw 'bad event type';
    }
  });
  
  $('#btn-run').on('click', function() {
    socket.emit(socketMsg.startDfs, 'Back atcha!');
  })
});
