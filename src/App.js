import "./App.css";
import { Paper, withStyles, Grid } from "@material-ui/core";
import * as eth from 'ethers';
import interval from "interval-promise";
import React from "react";
import { BrowserRouter as Router, Route, Redirect } from "react-router-dom";
import * as Connext from "connext";

// Pages
import Home from "./components/Home";
import DepositCard from "./components/depositCard";
import AppBarComponent from "./components/AppBar";
import SettingsCard from "./components/settingsCard";
import ReceiveCard from "./components/receiveCard";
import SendCard from "./components/sendCard";
import CashOutCard from "./components/cashOutCard";
import SupportCard from "./components/supportCard";
import RedeemCard from "./components/redeemCard";
import SetupCard from "./components/setupCard";
import Confirmations from "./components/Confirmations";
import MySnackbar from "./components/snackBar";

const bip39 = require("bip39");

const { Big, maxBN, minBN } = Connext.big
const { CurrencyType, CurrencyConvertable } = Connext.types
const { getExchangeRates } = Connext.getters

let publicUrl;

const humanTokenAbi = require("./abi/humanToken.json");

const env = process.env.NODE_ENV;
const tokenAbi = humanTokenAbi;

// Optional URL overrides for custom hubs
const overrides = {
  localHub: process.env.REACT_APP_LOCAL_HUB_OVERRIDE,
  localEth: process.env.REACT_APP_LOCAL_ETH_OVERRIDE,
  rinkebyHub: process.env.REACT_APP_RINKEBY_HUB_OVERRIDE,
  rinkebyEth: process.env.REACT_APP_RINKEBY_ETH_OVERRIDE,
  mainnetHub: process.env.REACT_APP_MAINNET_HUB_OVERRIDE,
  mainnetEth: process.env.REACT_APP_MAINNET_ETH_OVERRIDE,
};

// Constants for channel max/min - this is also enforced on the hub
const DEPOSIT_ESTIMATED_GAS = Big("700000") // 700k gas
const HUB_EXCHANGE_CEILING = eth.constants.WeiPerEther.mul(Big(69)); // 69 TST
const CHANNEL_DEPOSIT_MAX = eth.constants.WeiPerEther.mul(Big(30)); // 30 TST
const MAX_GAS_PRICE = Big("10000000000") // 10 gWei

const styles = theme => ({
  paper: {
    width: "100%",
    padding: `0px ${theme.spacing.unit}px 0 ${theme.spacing.unit}px`,
    [theme.breakpoints.up('sm')]: {
      width: "450px",
      height: "650px",
      marginTop: "5%",
      borderRadius: "4px"
    },
    [theme.breakpoints.down(600)]: {
      "box-shadow": "0px 0px"
    },
  },
  app: {
    display: "flex",
    justifyContent: "center",
    alignItems: "center",
    flexGrow: 1,
    fontFamily: ["proxima-nova", "sans-serif"],
    backgroundColor: "#FFF",
    width: "100%",
    margin: "0px",
  },
  zIndex: 1000,
  grid: {}
});

class App extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      loadingConnext: true,
      hubUrl: null,
      tokenAddress: null,
      contractAddress: null,
      hubWalletAddress: null,
      web3: null,
      tokenContract: null,
      connext: null,
      modals: {
        settings: false,
        keyGen: false,
        receive: false,
        send: false,
        cashOut: false,
        scan: false,
        deposit: false
      },
      authorized: "false",
      approvalWeiUser: "10000",
      channelState: null,
      exchangeRate: "0.00",
      interval: null,
      connextState: null,
      runtime: null,
      sendScanArgs: {
        amount: null,
        recipient: null
      },
      address: "",
      status: {
        txHash: "",
        type: "",
        reset: false,
      },
      browserMinimumBalance: null,
    };

    this.networkHandler = this.networkHandler.bind(this);
  }

  // ************************************************* //
  //                     Hooks                         //
  // ************************************************* //

  async componentDidMount() {
    // on mount, check if you need to refund by removing maxBalance
    localStorage.removeItem("refunding");

    // set public url
    publicUrl = window.location.origin.toLowerCase();

    // Get mnemonic and rpc type
    let mnemonic = localStorage.getItem("mnemonic");
    let rpc = localStorage.getItem("rpc-prod");

    // If no rpc, get from env and save to local storage
    if (!rpc) {
      rpc = env === "development" ? "LOCALHOST" : "MAINNET";
      localStorage.setItem("rpc-prod", rpc);
    }
    // If no mnemonic, create one and save to local storage
    if (!mnemonic) {
      mnemonic = bip39.generateMnemonic();
      localStorage.setItem("mnemonic", mnemonic);
    }  

    await this.setConnext(rpc, mnemonic);
    await this.setTokenContract();
    await this.pollConnextState();
    await this.setBrowserWalletMinimumBalance();
    await this.poller();
  }

  // ************************************************* //
  //                State setters                      //
  // ************************************************* //

  async networkHandler(rpc) {
    // called from settingsCard when a new RPC URL is connected
    // will refresh the page after
    localStorage.setItem("rpc-prod", rpc);
    // update refunding variable on rpc switch
    localStorage.removeItem("maxBalanceAfterRefund");
    localStorage.removeItem("refunding");
    window.location.reload();
    return;
  }

  async setConnext(rpc, mnemonic) {
    let hubUrl;
    switch (rpc) {
      case "LOCALHOST":
        hubUrl = overrides.localHub || `${publicUrl}/api/local/hub`;
        break;
      case "RINKEBY":
        hubUrl = overrides.rinkebyHub || `${publicUrl}/api/rinkeby/hub`;
        break;
      case "MAINNET":
        hubUrl = overrides.mainnetHub || `${publicUrl}/api/mainnet/hub`;
        break;
      default:
        throw new Error(`Unrecognized rpc: ${rpc}`);
    }

    const opts = {
      hubUrl: this.state.hubUrl,
      mnemonic,
    };
    const connext = await Connext.getConnextClient(opts)
    console.log(`Successfully set up connext! Connext config:`);
    console.log(`  - tokenAddress: ${connext.opts.tokenAddress}`);
    console.log(`  - hubAddress: ${connext.opts.hubAddress}`);
    console.log(`  - contractAddress: ${connext.opts.contractAddress}`);
    console.log(`  - ethNetworkId: ${connext.opts.ethNetworkId}`);
    console.log(`  - public address: ${connext.wallet.getAddressString()}`)
    const web3 = new eth.providers.JsonRpcProvider(connext.opts.rpcUrl)
    this.setState({
      connext,
      tokenAddress: connext.opts.tokenAddress,
      channelManagerAddress: connext.opts.contractAddress,
      hubWalletAddress: connext.opts.hubAddress,
      ethNetworkId: connext.opts.ethNetworkId,
      address: connext.wallet.getAddressString(),
      web3
    });
  }

  async setTokenContract() {
    try {
      let { tokenAddress } = this.state;
      const tokenContract = new eth.Contract(tokenAbi, tokenAddress);
      this.setState({ tokenContract });
    } catch (e) {
      console.log("Error setting token contract");
      console.log(e);
    }
  }

  // ************************************************* //
  //                    Pollers                        //
  // ************************************************* //

  async pollConnextState() {
    let connext = this.state.connext;
    // register connext listeners
    connext.on("onStateChange", state => {
      console.log("Connext state changed:", state);
      this.setState({
        channelState: state.persistent.channel,
        connextState: state,
        runtime: state.runtime,
        exchangeRate: state.runtime.exchangeRate
          ? state.runtime.exchangeRate.rates.USD
          : 0
      });
      this.checkStatus();
    });
    // start polling
    await connext.start();
    this.setState({ loadingConnext: false })
  }

  async poller() {
    await this.autoDeposit();
    await this.autoSwap();

    interval(
      async (iteration, stop) => {
        await this.autoDeposit();
      },
      5000
    )

    interval(
      async (iteration, stop) => {
        await this.autoSwap();
      },
      1000
    )

  }

  async setBrowserWalletMinimumBalance() {
    const {connextState} = this.state
    let gasEstimateJson = await eth.utils.fetchJson({url:`https://ethgasstation.info/json/ethgasAPI.json`})
    let currentGasPrice = gasEstimateJson.safeLow
    // dont let gas price be any higher than the min
    currentGasPrice = minBN(currentGasPrice, MAX_GAS_PRICE)
    // default connext multiple is 1.5, leave 2x for safety
    const totalDepositGasWei = DEPOSIT_ESTIMATED_GAS
      .mul(Big(2))
      .mul(currentGasPrice)

    // add dai conversion
    const minConvertable = new CurrencyConvertable(
      CurrencyType.WEI, 
      totalDepositGasWei, 
      () => getExchangeRates(connextState)
    )
    const browserMinimumBalance = { 
      wei: minConvertable.toWEI().amount, 
      dai: minConvertable.toUSD().amount 
    }
    this.setState({ browserMinimumBalance })
    return browserMinimumBalance
  }

  async autoDeposit() {
    const {
      address,
      tokenContract,
      connextState,
      tokenAddress,
      exchangeRate,
      channelState,
      connext,
      browserMinimumBalance,
      web3,
    } = this.state;
    const refunding = localStorage.getItem("refunding");

    if (!connext || !browserMinimumBalance || refunding) return;

    const balance = await web3.eth.getBalance(address);

    const maxBalanceAfterRefund = localStorage.getItem("maxBalanceAfterRefund");
    if (
      maxBalanceAfterRefund &&
      Big(balance).gte(Big(maxBalanceAfterRefund))
    ) {
      // wallet balance hasnt changed since submitting tx, returning
      return;
    } else {
      // tx has been submitted, delete the maxWalletBalance from storage
      localStorage.removeItem("refunding");
      localStorage.removeItem("maxBalanceAfterRefund");
    }

    let tokenBalance = "0";
    try {
      tokenBalance = await tokenContract.methods.balanceOf(address).call();
    } catch (e) {
      console.warn(
        `Error fetching token balance, are you sure the token address (addr: ${tokenAddress}) is correct for the selected network (id: ${await web3.eth.net.getId()}))? Error: ${
          e.message
        }`
      );
    }

    if (balance !== "0" || tokenBalance !== "0") {
      const minWei = Big(browserMinimumBalance.wei)
      if (Big(balance).lt(minWei)) {
        // don't autodeposit anything under the threshold
        // update the refunding variable before returning
        return;
      }
      // only proceed with deposit request if you can deposit
      if (
        // Either no state
        !connextState ||
        // Or nothing has been submitted
        (!connextState.runtime.deposit.submitted && !connextState.runtime.withdrawal.submitted && !connextState.runtime.collateral.submitted) ||
        // Or something was submitted but also confirmed
        (connextState.runtime.deposit.submitted && connextState.runtime.deposit.transactionHash) ||
        (connextState.runtime.withdrawal.submitted && connextState.runtime.withdrawal.transactionHash) ||
        (connextState.runtime.collateral.submitted && connextState.runtime.collateral.transactionHash)
        // exchangeRate === "0.00"
      ) {
        return;
      }

      // if you already have the maximum balance tokens hub will exchange
      // do not deposit any more eth to be swapped
      // TODO: figure out rounding error
      if (
        eth.utils
          .bigNumberify(channelState.balanceTokenUser)
          .gte(eth.utils.parseEther("29.8"))
      ) {
        // refund any wei that is in the browser wallet
        alert("TEMPORARY WARNING: You already have maximum balance. Refusing to deposit more for now.")
        
        // const refundWei = maxBN(
        //   Big(balance).sub(minWei),
        //   Big(0)
        // );
        // await this.returnWei(refundWei.toString());
        return;
      }

      let channelDeposit = {
        amountWei: Big(balance)
          .sub(minWei),
        amountToken: tokenBalance
      };

      if (
        channelDeposit.amountWei === "0" &&
        channelDeposit.amountToken === "0"
      ) {
        return;
      }

      // if amount to deposit into channel is over the channel max
      // then return excess deposit to the sending account
      const weiToReturn = this.calculateWeiToRefund(
        channelDeposit.amountWei,
        connextState
      );

      // return wei to sender
      if (weiToReturn !== "0") {
        alert("TEMPORARY WARNING: You've deposited more balance than the maximum. Only balance up to the maximum will be deposited - retrieve remaining funds by recovering your seed phrase into a wallet")
        // await this.returnWei(weiToReturn);
        return;
      }
      // update channel deposit
      const weiDeposit = Big(channelDeposit.amountWei).sub(
        Big(weiToReturn)
      );
      channelDeposit.amountWei = weiDeposit.toString();

      await this.state.connext.deposit(channelDeposit);
    }
  }

  // async returnWei(wei) {
  //   // const { address,connext } = this.state;
  //   // localStorage.setItem("refunding", Web3.utils.fromWei(wei, "finney"));

  //   // if (!connext) {
  //   //   return;
  //   // }

  //   // // if wei is 0, save gas and return
  //   // if (wei === "0") {
  //   //   return;
  //   // }

  //   // // get address of latest sender of most recent transaction
  //   // // first, get the last 10 blocks
  //   // const web3 = new Web3(connext.opts.rpcUrl);
  //   // const currentBlock = await web3.eth.getBlockNumber();
  //   // let txs = [];
  //   // const start = currentBlock - 100 < 0 ? 0 : currentBlock - 100;
  //   // for (let i = start; i <= currentBlock; i++) {
  //   //   // add any transactions found in the blocks to the txs array
  //   //   const block = await web3.eth.getBlock(i, true);
  //   //   txs = txs.concat(block.transactions);
  //   // }
  //   // // sort by nonce and take latest senders address and
  //   // // return wei to the senders address
  //   // const filteredTxs = txs.filter(
  //   //   t => t.to && t.to.toLowerCase() === address.toLowerCase()
  //   // );
  //   // const mostRecent = filteredTxs.sort((a, b) => b.nonce - a.nonce)[0];
  //   // if (!mostRecent) {
  //   //   // Browser wallet overfunded, but couldnt find most recent tx in last 100 blocks
  //   //   return;
  //   // }
  //   // localStorage.setItem(
  //   //   "refunding",
  //   //   Web3.utils.fromWei(wei, "finney") + "," + mostRecent.from
  //   // );
  //   // console.log(`Refunding ${wei} to ${mostRecent.from} from ${address}`);
  //   // const origBalance = Big(await web3.eth.getBalance(address));
  //   // const newMax = origBalance.sub(Big(wei));

  //   // try {
  //   //   const res = await web3.eth.sendTransaction({
  //   //     from: address,
  //   //     to: mostRecent.from,
  //   //     value: wei
  //   //   });
  //   //   const tx = await customWeb3.eth.getTransaction(res.transactionHash);
  //   //   console.log(`Returned deposit tx: ${JSON.stringify(tx, null, 2)}`)
  //   //   // calculate expected balance after transaction and set in local
  //   //   // storage. once the tx is submitted, the wallet balance should
  //   //   // always be lower than the expected balance, because of added
  //   //   // gas costs
  //   //   localStorage.setItem("maxBalanceAfterRefund", newMax.toString());
  //   // } catch (e) {
  //   //   console.log("Error with refund transaction:", e.message);
  //   //   localStorage.removeItem("maxBalanceAfterRefund");
  //   // }
  //   // localStorage.removeItem("refunding");
  //   // // await this.setWeb3(localStorage.getItem("rpc-prod"));
  // }

  // returns a BigNumber
  calculateWeiToRefund(wei, connextState) {
    // channel max tokens is minimum of the ceiling that
    // the hub would exchange, or a set deposit max
    const ceilingWei = new CurrencyConvertable(
      CurrencyType.BEI,
      minBN(HUB_EXCHANGE_CEILING, CHANNEL_DEPOSIT_MAX),
      () => getExchangeRates(connextState)
    ).toWEI().amountBN

    const weiToRefund = maxBN(
      Big(wei).sub(ceilingWei),
      Big(0)
    );

    return weiToRefund.toString();
  }

  async autoSwap() {
    const { channelState, connextState } = this.state;
    if (!connextState || !connextState.runtime.canExchange) {
      return;
    }
    const weiBalance = Big(channelState.balanceWeiUser);
    const tokenBalance = Big(channelState.balanceTokenUser);
    if (
      channelState &&
      weiBalance.gt(Big("0")) &&
      tokenBalance.lte(HUB_EXCHANGE_CEILING)
    ) {
      await this.state.connext.exchange(channelState.balanceWeiUser, "wei");
    }
  }

  async checkStatus() {
    const { runtime, status } = this.state;
    let log = () => {}
    let newStatus

    if(runtime) {
      log(`Hub Sync results: ${JSON.stringify(runtime.syncResultsFromHub[0],null,2)}`)
      if (runtime.deposit.submitted) {
        if (!runtime.deposit.detected) {
          newStatus.type = "DEPOSIT_PENDING"
        } else {
          newStatus.type = "DEPOSIT_SUCCESS"
          newStatus.txHash = runtime.deposit.transactionHash
        }
      }
      if (runtime.withdrawal.submitted) {
        if(!runtime.withdrawal.detected) {
          newStatus.type = "WITHDRAWAL_PENDING"
        } else {
          newStatus.type = "WITHDRAWAL_SUCCESS"
          newStatus.txHash = runtime.withdrawal.transactionHash
        }
      }
    }

    if(newStatus.type != status.type) {
      status = newStatus
      status.reset = true
      console.log(`New channel status! ${JSON.stringify(status)}`)
    }

    this.setState({status})
  }

  closeConfirmations() {

  }

  // ************************************************* //
  //                    Handlers                       //
  // ************************************************* //

  updateApprovalHandler(evt) {
    this.setState({
      approvalWeiUser: evt.target.value
    });
  }

  async scanURL(path, args) {
    switch (path) {
      case "/send":
        this.setState({
          sendScanArgs: { ...args }
        });
        break;
      case "/redeem":
        this.setState({
          redeemScanArgs: { ...args }
        });
        break;
      default:
        return;
    }
  }

  async closeModal() {
    await this.setState({ loadingConnext: false });
  };

  render() {
    const {
      address,
      channelState,
      sendScanArgs,
      exchangeRate,
      connext,
      connextState,
      runtime,
      browserMinimumBalance,
      web3
    } = this.state;
    const { classes } = this.props;
    return (
      <Router>
        <Grid className={classes.app}>
          <Paper elevation={1} className={classes.paper}>
            <MySnackbar
              variant="warning"
              openWhen={this.state.loadingConnext}
              onClose={() => this.closeModal()}
              message="Starting Channel Controllers.."
              duration={30000}
            />
            <Confirmations
              status={this.state.status}
              closeConfirmations={this.closeConfirmations.bind(this)}
            />
            <AppBarComponent address={address} />
            <Route
              exact
              path="/"
              render={props =>
                runtime && runtime.channelStatus !== "CS_OPEN" ? (
                  <Redirect to="/support" />
                ) : (
                  <Grid>
                    <Home
                      {...props}
                      address={address}
                      connextState={connextState}
                      channelState={channelState}
                      publicUrl={publicUrl}
                      scanURL={this.scanURL.bind(this)}
                    />

                    <SetupCard
                      {...props}
                      browserMinimumBalance={browserMinimumBalance}
                      maxTokenDeposit={CHANNEL_DEPOSIT_MAX.toString()}
                      connextState={connextState}
                    />
                  </Grid>
                )
              }
            />
            <Route
              path="/deposit"
              render={props => (
                <DepositCard
                  {...props}
                  address={address}
                  browserMinimumBalance={browserMinimumBalance}
                  exchangeRate={exchangeRate}
                  maxTokenDeposit={CHANNEL_DEPOSIT_MAX.toString()}
                  connextState={connextState}
                />
              )}
            />
            <Route
              path="/settings"
              render={props => (
                <SettingsCard
                  {...props}
                  networkHandler={this.networkHandler}
                  connext={connext}
                  address={address}
                  exchangeRate={exchangeRate}
                  runtime={this.state.runtime}
                />
              )}
            />
            <Route
              path="/receive"
              render={props => (
                <ReceiveCard
                  {...props}
                  address={address}
                  connextState={connextState}
                  maxTokenDeposit={CHANNEL_DEPOSIT_MAX.toString()}
                  channelState={channelState}
                  publicUrl={publicUrl}
                />
              )}
            />
            <Route
              path="/send"
              render={props => (
                <SendCard
                  {...props}
                  web3={web3}
                  connext={connext}
                  address={address}
                  channelState={channelState}
                  publicUrl={publicUrl}
                  scanArgs={sendScanArgs}
                  connextState={connextState}
                />
              )}
            />
            <Route
              path="/redeem"
              render={props => (
                <RedeemCard
                  {...props}
                  publicUrl={publicUrl}
                  connext={connext}
                  channelState={channelState}
                  connextState={connextState}
                />
              )}
            />
            <Route
              path="/cashout"
              render={props => (
                <CashOutCard
                  {...props}
                  address={address}
                  channelState={channelState}
                  publicUrl={publicUrl}
                  exchangeRate={exchangeRate}
                  web3={web3}
                  connext={connext}
                  connextState={connextState}
                  runtime={runtime}
                />
              )}
            />
            <Route
              path="/support"
              render={props => (
                <SupportCard {...props} channelState={channelState} />
              )}
            />
          </Paper>
        </Grid>
      </Router>
    );
  }
}

export default withStyles(styles)(App);
