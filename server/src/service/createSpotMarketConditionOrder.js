import Decimal from 'decimal.js'

import { getExchangeMonitor } from '../monitor/exchangeMonitor.js'
import { ORDER_TYPES, ORDER_SIDES, ORDER_AMOUNT_TYPES, POSITION_SIDES } from '../../../share/const.js'
import { getPrecisionLength } from '../../../share/utils.js'
import orderWatcher from '../monitor/orderMonitor.js'

export default async function createSpotMarketConditionOrder(data) {
    
}