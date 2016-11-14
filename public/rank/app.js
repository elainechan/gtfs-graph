import React from 'react';
import DOM from 'react-dom';
import IO from 'socket.io-client';
import classNames from 'classnames';
import { Map, RouteList, Popup, GitHubRibbon, Modal, ModalTrigger } from '../../lib/dom/index';
import socketMsg from '../../lib/constants.js';

const MODES = {
  pageRank: 'Page Rank',
  closeness: 'Closeness',
  katz: 'Katz',
  accessibility: 'Accessibility'
};

const CITIES = {
  nyc: 'NYC',
  boston: 'Boston',
  paris: 'Paris'
};

const MODAL_ID = 'infoModal';

const ZOOM = 13;

var GraphRankDisplay = React.createClass({
  getInitialState: function() {
    return {
      infoBoxContents: [],
      stops: undefined,
      system: undefined,
      hoverStop: undefined,
      mode: MODES.accessibility
    };
  },
  componentDidMount: function() {
    let { system } = this.props;
    
    this.socket = IO();
    let { socket } = this;
    
    socket.emit(socketMsg.requestSystem, system);
    socket.on(socketMsg.sendSystem, this._socketSendSystemHandler);
    
    socket.on(socketMsg.sendMergedEdges, this._socketSendEdgesHandler);
    socket.on(socketMsg.sendMergedStops, this._socketSendMergedStopsHandler);
    socket.on(socketMsg.event, this._socketEventHandler);
  },
  _socketSendSystemHandler: function(system) {
    this.refs.map.setCenter(system.longitude, system.latitude, ZOOM);
    this.setState({ 
      system: system.id
    });
  },
  _socketSendMergedStopsHandler: function(stops) {
    this.setState({ stops });
    this.refs.map.addStops(stops);
  },
  _socketSendEdgesHandler: function(edges) {
    this.refs.map.addEdges(edges);
  },
  _socketEventHandler: function(event) {
    if (event.type === socketMsg.showRanks) {
      this.setState({ infoBoxContents: this._orderStopsByRank(event.data) });
      this.refs.map.showRanks(this.state.stops,event.data);
    }
  },
  _orderStopsByRank: function(ranks) {
    let stopsWithRanks = [];
    let { stops } = this.state;
    
    ranks.forEach(function(rank, node) {
      let stop = stops[node];
      stop.rank = Math.round(rank * 100000) / 100000;
      stopsWithRanks.push(stop);
    });
    return stopsWithRanks.sort((a,b) => {
      if (a.rank < b.rank)
        return 1;
      if (a.rank > b.rank)
        return -1;
      return 0;
    });
  },
  handleMapLoad: function() {
    const { system } = this.props;
    const { mode } = this.state;
    this.socket.emit(socketMsg.requestMergedStops, system);
    this.socket.emit(socketMsg.requestMergedEdges, system);
    this.socket.emit(socketMsg.getMode, system, mode);
  },
  handleStopHover: function(stopId) {
    if (typeof stopId === "undefined") {
      this.setState({ hoverStop: undefined });
    } else {
      this.setState({ hoverStop: this._lookupStop(stopId) });
    }
  },
  handleStopClick: function(stopId) {
    const stop = this._lookupStop(stopId);
    this.setState({ hoverStop: stop });
    this.refs.map.panTo(stop);
  },
  _lookupStop: function(stopId) {
    return this.state.stops[this.state.stops.map(stop => stop.id).indexOf(stopId)];
  },
  _handleModeChange: function(mode) {
    this.socket.emit(socketMsg.getMode, this.props.system, mode);
    this.setState({ mode });
  },
  render: function() {
    const { hoverStop, infoBoxContents } = this.state;
    const { system } = this.props;
    var showIcons = system !== 'MBTA';
    var self      = this;
    
    let ranks = infoBoxContents.map(function(stop) {
      return (
        <table
          key={stop.id}
          className='stop-table'
          onMouseOver={self.handleStopHover.bind(null, stop.id)}
          onClick={self.handleStopClick.bind(null, stop.id)}
        >
        <tbody>
        <tr>
          <td className='cell-rank'>{infoBoxContents.indexOf(stop)+1}.</td>
          <td className='cell-rank'><b>{stop.rank}</b></td>
          <td className='cell-name'>{stop.name}</td>
        </tr>
        <tr>
          <td className='cell-routes' colSpan='3'>
            <RouteList
              system={system}
              showIcons={showIcons}
              stop={stop}
              key={stop.id}
            />
          </td>
        </tr>
        </tbody>
        </table>
      );
    });
    
    function navigateTo(system) {
      let url = '/rank/' + system.toLowerCase();
      window.location = url;
    }
    let currentMode = this.state.mode;
    let currentCity = this.props.city;
    
    let buttons = Object.values(CITIES).map(function(system) {
      let btnClasses = classNames({
        btn: true,
        'btn-primary': system === currentCity
      });
      return (<button className={btnClasses} onClick={navigateTo.bind(null, system)} key={system}>{system}</button>);
    });
    let modes = Object.values(MODES).map(function(mode) {
      let btnClasses = classNames({
        btn: true,
        'btn-primary': mode === currentMode
      });
      return (<button className={btnClasses} onClick={self._handleModeChange.bind(null, mode)} key={mode}>{mode}</button>);
    });
    
    return (
      <div>
        <Modal
          id={MODAL_ID}
          title='About'
        >
          <p>This project has two goals:</p>
          <ol>
            <li>Identify the most important stations in a transit network.</li>
            <li>Characterize the distribution of stations' importance across networks.</li>
          </ol>
          <h4>Page Rank</h4>
          <h4>Closeness Centrality</h4>
          <h4>Katz Centrality</h4>
          <h4>Outward Accessibility</h4>
        </Modal>
        <GitHubRibbon />
        <Map
          onMapLoad={this.handleMapLoad}
          onStopHover={this.handleStopHover}
          ref='map'
        >
        { hoverStop && (
          <Popup
            longitude={hoverStop.longitude}
            latitude={hoverStop.latitude}
          >
            <div className='popup'>
              <div><em>{hoverStop.name}</em></div>
              <div>{currentMode}: {hoverStop.rank}</div>
              <div>Rank: {infoBoxContents.indexOf(hoverStop)+1} of {infoBoxContents.length}</div>
              <div><RouteList system={system} showIcons={showIcons} stop={hoverStop} /></div>
            </div>
          </Popup>
        )}
        </Map>
        <div className='system-selector'>
          {buttons}
        </div>
        <div className='mode-selector'>
          {modes}
        </div>
        <div className='side-panel'>
          <div>
            <h1>{currentCity}</h1>
            <ModalTrigger id={MODAL_ID} label='Info' />
          </div>
          <div className='ranks'>
            {ranks}
          </div>
          <div id='legend'>
            <p><strong>Centrality Ranking</strong></p>
            <nav className='clearfix'>
              <span style={{background: '#00ff00'}}></span>
              <span style={{background: '#00ffff'}}></span>
              <span style={{background: '#0000ff'}}></span>
              <span style={{background: '#ff00ff'}}></span>
              <span style={{background: '#ff0000'}}></span>
              <label>Low</label>
              <label></label>
              <label>Medium</label>
              <label></label>
              <label>High</label>
            </nav>
          </div>
          <div>
            A <a href="http://www.tyleragreen.com/" target="_blank">Tyler A. Green</a> Project. See <a href="/demo">how this works</a>!
          </div>
        </div>
      </div>
    );
  }
});

module.exports = GraphRankDisplay;