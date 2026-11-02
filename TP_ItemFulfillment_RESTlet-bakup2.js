/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * Tap Phong Trading Company
 * Item Fulfillment RESTlet - Lesson 1
 *
 * READ-ONLY VERSION
 *
 * This RESTlet:
 *   1. Loads a Sales Order
 *   2. Reads its item lines
 *   3. Calculates remaining quantities
 *   4. Checks existing Item Fulfillments
 *   5. Returns JSON to Postman
 *
 * It does NOT create or modify transactions.
 */

define(['N/record', 'N/search', 'N/error', 'N/log'],
    (record, search, error) => {

        // ------------------------------------------------
        // 1. Error handling helper
        // ------------------------------------------------

        function fail(code, message) {

            const nsError = error.create({
                name: code,
                message: message
            });

            throw nsError;
        }

        // ------------------------------------------------
        // 2. Find existing Item Fulfillments
        // ------------------------------------------------

        function getExistingFulfillments(soId) {

            const results = [];

            const fulfillmentSearch = search.create({

                type: 'itemfulfillment',

                filters: [
                    ['createdfrom', 'anyof', soId],
                    'AND',
                    ['mainline', 'is', 'T']
                ],

                columns: [
                    'internalid',
                    'tranid',
                    'trandate'
                ]

            });

            fulfillmentSearch.run().each(function(result) {

                results.push({

                    internalId: result.getValue({
                        name: 'internalid'
                    }),

                    documentNumber: result.getValue({
                        name: 'tranid'
                    }),

                    date: result.getValue({
                        name: 'trandate'
                    })

                });

                return true;
            });

            return results;
        }

        // ------------------------------------------------
        // 3. POST entry point
        // ------------------------------------------------

        function post(context) {

            // try {

                log.audit({
                    title: 'RESTlet POST started',
                    details: JSON.stringify(context, null, 2)
                });

            const request = context || {};

            const soId = Number(request.soId);
            const itemId = Number(request.itemId);
            const requestedQty = Number(request.quantity);

            // --------------------------------------------
            // Validate input
            // --------------------------------------------

            if (!Number.isSafeInteger(soId) || soId <= 0) {

                fail(
                    'INVALID_SO_ID',
                    'A valid Sales Order internal ID is required.'
                );
            }

            if (!Number.isSafeInteger(itemId) || itemId <= 0) {

                fail(
                    'INVALID_ITEM_ID',
                    'A valid Item internal ID is required.'
                );
            }

            if (!Number.isFinite(requestedQty) ||
                requestedQty <= 0) {

                fail(
                    'INVALID_QUANTITY',
                    'Quantity must be greater than zero.'
                );
            }

            // --------------------------------------------
            // Load Sales Order
            // --------------------------------------------

            const salesOrder = record.load({

                type: 'salesorder',
                id: soId,
                isDynamic: false

            });

            const soNumber = salesOrder.getValue({
                fieldId: 'tranid'
            });

            const status = salesOrder.getText({
                fieldId: 'orderstatus'
            });

            const customerId = salesOrder.getValue({
                fieldId: 'entity'
            });

            const lineCount = salesOrder.getLineCount({
                sublistId: 'item'
            });

            // --------------------------------------------
            // Read item lines
            // --------------------------------------------

            const items = [];

            let matchingItem = null;
            let matchingCount = 0;

            for (let i = 0; i < lineCount; i++) {

                const currentItemId = Number(
                    salesOrder.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'item',
                        line: i
                    })
                );

                const orderedQty = Number(
                    salesOrder.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'quantity',
                        line: i
                    })
                ) || 0;

                const fulfilledQty = Number(
                    salesOrder.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'quantityfulfilled',
                        line: i
                    })
                ) || 0;

                const remainingQty =
                    orderedQty - fulfilledQty;

                const lineInfo = {

                    line: i,

                    itemId: currentItemId,

                    ordered: orderedQty,

                    fulfilled: fulfilledQty,

                    remaining: remainingQty

                };

                items.push(lineInfo);

                if (currentItemId === itemId) {

                    matchingItem = lineInfo;
                    matchingCount++;
                }
            }

            // --------------------------------------------
            // Validate matching item
            // --------------------------------------------

            if (matchingCount === 0) {

                fail(
                    'ITEM_NOT_FOUND',
                    'Item ' + itemId +
                    ' was not found on Sales Order ' +
                    soNumber
                );
            }

            if (matchingCount > 1) {

                fail(
                    'MULTIPLE_ITEM_LINES',
                    'The item appears on multiple Sales Order lines.'
                );
            }

            // --------------------------------------------
            // Check remaining quantity
            // --------------------------------------------

            const enoughQuantity =
                requestedQty <= matchingItem.remaining;

            // --------------------------------------------
            // Find existing Item Fulfillments
            // --------------------------------------------

            const existingFulfillments =
                getExistingFulfillments(soId);

            // --------------------------------------------
            // Return preview
            // --------------------------------------------

            return {

                success: true,

                mode: 'PREVIEW_ONLY',

                salesOrder: {

                    internalId: soId,
                    documentNumber: soNumber,
                    customerId: customerId,
                    status: status

                },

                requestedFulfillment: {

                    itemId: itemId,
                    quantity: requestedQty

                },

                matchingItem: matchingItem,

                enoughQuantity: enoughQuantity,

                existingFulfillments: existingFulfillments,

                items: items,

                message:
                    'Preview completed. No Item Fulfillment was created.'

            };
    //     }catch (e) {

    //     log.error({
    //         title: 'RESTlet POST ERROR',
    //         details: JSON.stringify({
    //             name: e.name,
    //             message: e.message,
    //             stack: e.stack
    //         })
    //     });

    //     return {
    //         success: false,
    //         error: {
    //             name: e.name,
    //             message: e.message
    //         }
    //     };
    // }
}
        

        // ------------------------------------------------
        // 4. GET entry point
        // ------------------------------------------------

        function get(context) {

            return {

                success: true,

                message:
                    'TP Item Fulfillment RESTlet is running',

                version: '1.0 - Preview Only',

                method: 'GET'

            };
        }

        // ------------------------------------------------
        // 5. Export RESTlet entry points
        // ------------------------------------------------

        return {

            get: get,
            post: post

        };

    });