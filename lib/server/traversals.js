'use strict';

var async = require('async');
var fs = require("fs");
var Edge = require('./edge.js');
var logger = require('./logger.js');
var TransitGraph = require('./graph.js');
var BasicTraverser = require('./graphTraverser.js').BasicTraverser;

//---------------------------------------------------
// Depth-First Search

var dfs = function(graph, node, traverser) {
  // Create an array to track whether a node has been visited
  for (var D = []; D.length < graph.numNodes; D.push(false));
  
  // Create an immediately invoke the recursive DFS explore
  (function dfsExplore(graph, traverser, node, parent) {
    D[node] = true;
    
    if (traverser && parent) { traverser.visit(graph.createEdge(parent, node)); }
    if (traverser) traverser.visitNode(node);
    
    for (let i = 0; i < graph.numNodes; i++) {
      if (graph.edgeExists(node, i) && !D[i]) {
        dfsExplore(graph, traverser, i, node);
      }
    }
    
    if (traverser && parent) { traverser.leave(graph.createEdge(node, parent)); }
  })(graph, traverser, node);
  
  if (traverser) { traverser.summary({ stationsVisited: traverser.visitedNodes.length }); }
};

//---------------------------------------------------
// Breadth-First Search

var bfs = function(graph, startingNode, traverser, callback) {
  // Create an array to act as the nodes-to-visit 'Q'ueue
  let Q = [];
  // Create an array to track whether a node has been visited
  for (var D = []; D.length < graph.numNodes; D.push(false));
  
  // Mark the first node as visited
  Q.push(startingNode);
  D[startingNode] = true;
  if (traverser) traverser.visitNode(startingNode);
  
  // Use an async method to allow other requests to be serviced
  // while the BFS is being performed
  async.whilst(
    
    // Continue the loop while the nodes-to-visit Queue is not empty
    function() { return Q.length > 0; },
    function(callback) {
      let node = Q.shift();
      
      for (var i = 0; i < graph.G.length; i++) {
        if (graph.edgeExists(node, i) && !D[i]) {
          Q.push(i);
          D[i] = true;
          
          if (traverser) { traverser.visit(graph.createEdge(node, i)); }
          if (traverser) traverser.visitNode(node);
        }
      }
      
      // Indicate that the next loop iteration should occur on the next 
      // tick of the Node event loop
      setImmediate(function() {
        callback(null, Q);
      });
    },
    function (err, n) {
      if (err) throw err;
      
      logger.info('bfs done');
      
      if (traverser) { traverser.summary({ stationsVisited: traverser.visitedNodes.length }); }
      
      if (callback) { callback(); }
    }
  );
};

//---------------------------------------------------
// Page Rank

var pageRank = function(graph, traverser) {
  const damping = 1;
  const initialRank = 1.0;
  let iterations = 10;
  
  const outgoingEdgeCounts = [];
  let incomingNodes;
  let ranks;

  for (ranks = []; ranks.length < graph.length(); ranks.push(initialRank));
  for (incomingNodes = []; incomingNodes.length < graph.length(); incomingNodes.push([]));
  
  (function countOutgoingEdges() {
    for (let i = 0; i < graph.length(); i++) {
      var edgeCount = 0;
      for (let j = 0; j < graph.length(); j++) {
        if (graph.edgeExists(i, j)) { edgeCount += 1; }
      }
      outgoingEdgeCounts.push(edgeCount);
    }
  })();
  
  (function countIncomingEdges() {
    for (let i = 0; i < graph.length(); i++) {
      for (let j = 0; j < graph.length(); j++) {
        if (graph.edgeExists(i, j)) { incomingNodes[j].push(i); }
      }
    }
  })();
  
  function updateRank(nodeIndex) {
    var inNodeSummation = 0;
  
    incomingNodes[nodeIndex].forEach(function(incoming, index) {
      inNodeSummation += (ranks[incoming] / outgoingEdgeCounts[incoming]);
    });
    
    return ((1 - damping) / graph.length()) + (damping * inNodeSummation);
  }
  
  while (iterations--) {
    for (let node = 0; node < graph.length(); node++) {
      ranks[node] = updateRank(node);
    }
  }
  
  if (traverser) { traverser.recordRanks(ranks.slice()); }
  if (traverser) { traverser.summary({ ranks: ranks }); }
  
  let results = 'sep=;\n';
  ranks.forEach(function(rank, node) {
    let stop = graph.stops[node];
    logger.info("Rank of node " + node + " (" + stop.name + ") is " + rank);
    results += node + ';' + stop.id + ';' + stop.name + ';' + stop.routes + ';' + rank + '\n';
  });
  fs.writeFile('pageRank.csv', results, (err) => {
    if (err) throw err;
    logger.info('Results saved to file');
  });
};

var mergeTransferNodes = function(graph, socket) {
  
  if (graph.getTransferEdges().length === 0) {
    return undefined;
  }
  
  while (graph.getTransferEdges().length > 0) {
    
    // Create simplified graph for use with page rank
    // 1) Create graph from transfer edges
    const transferGraph = new TransitGraph(graph.getTransferEdges(), graph.numNodes, graph.stops);
    let seenNodes = [];
    let nodeGroupings = [];
    
    
    // 2) Run DFS on the transfer edge graph, starting from each node and
    //    storing away the unique edges one can reach from each
    for (let node=0; node < transferGraph.G.length; node++) {
      if (seenNodes.indexOf(node) === -1) {
        let traverser = new BasicTraverser();
        dfs(transferGraph, node, traverser);
        nodeGroupings.push(traverser.visitedNodes);
        traverser.visitedNodes.forEach((node) => seenNodes.push(node));
      }
    }
    
    // Remove the node groupings that only contain a single node.
    // This meant there were no transfers connecting this node with another one.
    let nodesToMerge = nodeGroupings.filter(e => e.length > 1);
   
    // Create a copy of the graph so we can merge nodes out of it
    var newGraph = [];
    graph.G.forEach(function(rowOfNodes) {
      newGraph.push(rowOfNodes.slice());
    });
    
    // Create a copy of the stops so we can merge the attributes of merged stops
    var newStops = graph.stops.slice();
    
    // Actually perform the merge on the first two nodes found
    mergeTop(nodesToMerge[0][0], nodesToMerge[0][1]);
    
    // The new graph will have one less nodes than before because two nodes
    // were removed and one was added
    let newNumNodes = graph.numNodes - 1;
    
    let newEdgeList = [];
    for (let i = 0; i < newGraph.length; i++) {
      for (let j = 0; j < i; j++) {
        if (newGraph[i][j] !== 0) {
          newEdgeList.push(new Edge({ type: newGraph[i][j].type, origin: i, destination: j, weight: newGraph[i][j].weight }));
        }
      }
    }
    
    graph = new TransitGraph(newEdgeList, newNumNodes, newStops);
  }
  
  return graph;
  
  // This algorithm is adapted from the following paper:
  // Efficiently Merging Graph Nodes With Application to Cluster Analysis
  // Alex Ostrovsky
  // 2007-04-20
  function mergeTop(indexA, indexB) {
    if (indexA < indexB) {
      merge(indexA, indexB);
    } else {
      merge(indexB, indexA);
    }
  }
  
  function mergeEdges(edgeA, edgeB) {
    if (edgeA === 0 && edgeB === 0) {
      return 0;
    } else if (edgeA.type === 'transfer' || edgeB.type === 'transfer') {
      return { type: 'transfer', weight: -1 };
    } else {
      return { type: 'route', weight: -1 };
    }
  }
  
  function merge(loIndex, hiIndex) {
    let newStop = newStops[loIndex].mergeWith(newStops[hiIndex]);
    newStops.push(newStop);
    newStops.splice(loIndex,1);
    newStops.splice(hiIndex-1,1);
    
    // Add a row to the new graph to represent the union
    for (var newRow = []; newRow.length < newGraph.length - 1; newRow.push(0));
    newGraph.push(newRow);
    
    // This represents the index of the new merged row, which we place at
    // the bottom of the adjacency matrix
    let unionIndex = newGraph.length - 1;
    
    horizontalOverlap(loIndex, hiIndex, unionIndex);
    horizontalHiOvershoot(loIndex, hiIndex, unionIndex);
    verticalOverlap(loIndex, hiIndex, unionIndex);
    verticalLoOvershoot(loIndex, hiIndex, unionIndex);
    
    // Remove the two elements of the new row that were not populated,
    // which will be at the indices of the two rows that were merged
    newGraph[unionIndex].splice(loIndex,1);
    newGraph[unionIndex].splice(hiIndex-1,1);
    
    // Remove the two rows in the graph that are now merged
    // For the second, we need to subtract one since the array is no one shorter
    newGraph.splice(loIndex,1);
    newGraph.splice(hiIndex-1,1);
    
    // Remove any null elements from the rest of the graph
    // This is not a hack, the previous methods leave nulls in cells intentionally
    for (let i = 0; i < newGraph.length - 1; i++) {
      while (newGraph[i].indexOf(null) !== -1) {
        newGraph[i].splice(newGraph[i].indexOf(null),1);
      }
    }
  }
  
  function horizontalOverlap(loIndex, hiIndex, unionIndex) {
    let loLows = newGraph[loIndex];
    let hiLows = newGraph[hiIndex];
    let unionLows = newGraph[unionIndex];
    
    for (let i = 0; i < loIndex; i++) {
      unionLows[i] = mergeEdges(loLows[i], hiLows[i]);
      newGraph[loIndex][i] = null;
    }
  }
  function horizontalHiOvershoot(loIndex, hiIndex, unionIndex) {
    let hiLows = newGraph[hiIndex];
    let unionLows = newGraph[unionIndex];
    
    for (let i = loIndex + 1; i < hiIndex; i++) {
      unionLows[i] = mergeEdges(hiLows[i], 0);
    }
    for (let i = 0; i < hiIndex; i++) {
      newGraph[hiIndex][i] = null;
    }
  }
  function verticalOverlap(loIndex, hiIndex, unionIndex) {
    let unionLows = newGraph[unionIndex];
    
    for (let i = hiIndex + 1; i < unionIndex; i++) {
      let subGraph = newGraph[i];
      unionLows[i] = mergeEdges(subGraph[loIndex], subGraph[hiIndex]);

      subGraph[loIndex] = null;
      subGraph[hiIndex] = null;
    }
  }
  function verticalLoOvershoot(loIndex, hiIndex, unionIndex) {
    let unionLows = newGraph[unionIndex];
    
    for (let i = loIndex + 1; i < hiIndex; i++) {
      let overlap = newGraph[i][loIndex];
      
      unionLows[i] = mergeEdges(overlap, unionLows[i]);
      newGraph[i][loIndex] = null;
    }
  }
};

var dijkstra = function(graph, start, end, traverser) {
  var MAX = Infinity;
  for (var S = []; S.length < graph.length(); S.push(MAX));
  for (var D = []; D.length < graph.length(); D.push(false));
  for (var P = []; P.length < graph.length(); P.push(0));
  
  var minIndex, minDistance;
  var iterations = graph.length();
  S[start] = 0;
  
  while (iterations--) {
    minDistance = MAX;
    for (let i=0; i < graph.length(); i++) {
      if (S[i] < minDistance && !D[i]) {
        minDistance = S[i];
        minIndex = i;
      }
    }
    if (minDistance === MAX) break;
    D[minIndex] = true;
    
    for (let i=0; i < graph.length(); i++) {
      if (graph.edgeExists(minIndex,i) && S[i] > S[minIndex] + graph.getWeight(minIndex,i)) {
        S[i] = S[minIndex] + graph.getWeight(minIndex,i);
        P[i] = minIndex;
      }
    }
  }
  
  if (S[end] === MAX) {
    logger.info('No path between ' + start + ' and ' + end + '.');
  } else {
    logger.info('Path length between ' + start + ' and ' + end + ' is ' + S[end] + '.');
  }
  
  var path = [];
  let i = end;
  while (P[i] !== 0) {
    path.push(graph.createEdge(P[i],i));
    i = P[i];
  }
  
  if (traverser) {
    path.reverse().forEach(function(edge) {
      traverser.visit(edge);
    });
    
    traverser.summary({ pathLength: S[end]});
  }
};

module.exports = { dfs: dfs,
                   bfs: bfs,
                   pageRank: pageRank,
                   mergeTransferNodes: mergeTransferNodes,
                   dijkstra: dijkstra };
