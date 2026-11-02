/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 *
 * Tap Phong Trading Company Inc.
 *
 * CartonCloud -> Node.js -> NetSuite
 *
 * Version: 3.0
 * Mode: DRY_RUN
 *
 * Purpose:
 * Validate a CartonCloud dispatch and prepare
 * a NetSuite Item Fulfillment.
 *
 * IMPORTANT:
 * This version DOES NOT save the fulfillment.
 */

define(['N/record', 'N/search', 'N/log'],
    (record, search, log) => {

    // ==========================================
    // CONFIGURATION
    // ==========================================

    const CONFIG = {
        DRY_RUN: true,

        // NetSuite Sandbox test configuration
        TEST_SO_ID: 853,
        TEST_ITEM_ID: 1035,
        TEST_LOCATION_ID: 5,

        // Inventory Status: Good
        GOOD_STATUS_ID: 1,

        // CartonCloud warehouse
        CC_WAREHOUSE_ID:
            'fb85e6cf-38d3-11f1-86ad-06793d37df4b'
    };


    // ==========================================
    // GET - HEALTH CHECK
    // ==========================================

    function get(context) {

        return {
            success: true,
            version: '3.0',
            mode: 'DRY_RUN',
            message: 'TP Item Fulfillment V3 RESTlet working'
        };
    }


    // ==========================================
    // VALIDATE REQUEST
    // ==========================================

    function validateRequest(context) {

        if (!context || typeof context !== 'object') {
            throw new Error('Request body must be JSON');
        }

        const soId = Number(context.soId);
        const itemId = Number(context.itemId);
        const quantity = Number(context.quantity);
        const locationId = Number(context.locationId);
        const dispatchId = context.dispatchId;

        if (!Number.isSafeInteger(soId) || soId <= 0) {
            throw new Error('Invalid Sales Order ID');
        }

        if (!Number.isSafeInteger(itemId) || itemId <= 0) {
            throw new Error('Invalid Item ID');
        }

        if (!Number.isFinite(quantity) || quantity <= 0) {
            throw new Error('Invalid fulfillment quantity');
        }

        if (!Number.isSafeInteger(locationId) ||
            locationId <= 0) {
            throw new Error('Invalid location ID');
        }

        if (typeof dispatchId !== 'string' ||
            !dispatchId.trim()) {
            throw new Error('CartonCloud dispatchId is required');
        }

        if (dispatchId.length > 100) {
            throw new Error('dispatchId is too long');
        }

        // Restrict V3 testing to our known Sandbox records.
        if (soId !== CONFIG.TEST_SO_ID) {
            throw new Error('Unexpected Sales Order ID');
        }

        if (itemId !== CONFIG.TEST_ITEM_ID) {
            throw new Error('Unexpected Item ID');
        }

        if (locationId !== CONFIG.TEST_LOCATION_ID) {
            throw new Error('Unexpected warehouse location');
        }

        return {
            soId,
            itemId,
            quantity,
            locationId,
            dispatchId: dispatchId.trim()
        };
    }


    // ==========================================
    // CHECK DUPLICATE DISPATCH
    // ==========================================

    function checkDuplicate(soId, dispatchId) {

        const memo = 'CartonCloud Dispatch: ' + dispatchId;

        const results = search.create({

            type: search.Type.ITEM_FULFILLMENT,

            filters: [
                ['createdfrom', 'anyof', String(soId)],
                'AND',
                ['mainline', 'is', 'T'],
                'AND',
                ['memo', 'is', memo]
            ],

            columns: [
                'internalid',
                'tranid',
                'memo'
            ]

        }).run().getRange({
            start: 0,
            end: 10
        });

        return results.map(result => ({
            internalId: result.id,

            fulfillmentNumber: result.getValue({
                name: 'tranid'
            }),

            memo: result.getValue({
                name: 'memo'
            })
        }));
    }


    // ==========================================
    // POST - PREPARE ITEM FULFILLMENT
    // ==========================================

    function post(context) {

        try {

            // ----------------------------------
            // STEP 1: Validate request
            // ----------------------------------

            const request = validateRequest(context);

            const {
                soId,
                itemId,
                quantity,
                locationId,
                dispatchId
            } = request;

            log.audit({
                title: 'V3 START',
                details: JSON.stringify(request)
            });


            // ----------------------------------
            // STEP 2: Duplicate dispatch check
            // ----------------------------------

            const duplicates = checkDuplicate(
                soId,
                dispatchId
            );

            if (duplicates.length > 0) {

                return JSON.stringify({
                    success: false,
                    test: 'DUPLICATE_DISPATCH',
                    message:
                        'This CartonCloud dispatch has already been processed',
                    dispatchId,
                    duplicates
                });
            }


            // ----------------------------------
            // STEP 3: Transform Sales Order
            // ----------------------------------

            const fulfillment = record.transform({

                fromType: record.Type.SALES_ORDER,
                fromId: soId,

                toType: record.Type.ITEM_FULFILLMENT,

                isDynamic: false
            });


            // ----------------------------------
            // STEP 4: Find and validate item
            // ----------------------------------

            const lineCount = fulfillment.getLineCount({
                sublistId: 'item'
            });

            let targetLine = -1;
            let matchingLineCount = 0;
            let remainingQuantity = 0;

            for (let i = 0; i < lineCount; i++) {

                const currentItemId = Number(
                    fulfillment.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'item',
                        line: i
                    })
                );

                const currentLocationId = Number(
                    fulfillment.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'location',
                        line: i
                    })
                );

                const currentQuantity = Number(
                    fulfillment.getSublistValue({
                        sublistId: 'item',
                        fieldId: 'quantity',
                        line: i
                    })
                );

                // Exclude every line by default.
                fulfillment.setSublistValue({
                    sublistId: 'item',
                    fieldId: 'itemreceive',
                    line: i,
                    value: false
                });

                if (currentItemId === itemId &&
                    currentLocationId === locationId) {

                    matchingLineCount++;

                    targetLine = i;
                    remainingQuantity = currentQuantity;
                }
            }

            if (matchingLineCount === 0) {
                throw new Error(
                    'Item and location not found on fulfillment'
                );
            }

            if (matchingLineCount > 1) {
                throw new Error(
                    'Multiple matching lines found. ' +
                    'Sales Order line identifier is required.'
                );
            }

            if (!Number.isFinite(remainingQuantity) ||
                remainingQuantity <= 0) {
                throw new Error(
                    'No remaining quantity available to fulfill'
                );
            }

            if (quantity > remainingQuantity) {
                throw new Error(
                    'Requested quantity ' + quantity +
                    ' exceeds remaining fulfillment quantity ' +
                    remainingQuantity
                );
            }


            // ----------------------------------
            // STEP 5: Set fulfillment line
            // ----------------------------------

            fulfillment.setSublistValue({
                sublistId: 'item',
                fieldId: 'itemreceive',
                line: targetLine,
                value: true
            });

            fulfillment.setSublistValue({
                sublistId: 'item',
                fieldId: 'quantity',
                line: targetLine,
                value: quantity
            });


            // ----------------------------------
            // STEP 6: Inventory Detail
            // ----------------------------------

            const inventoryDetail =
                fulfillment.getSublistSubrecord({
                    sublistId: 'item',
                    fieldId: 'inventorydetail',
                    line: targetLine
                });

            const existingCount =
                inventoryDetail.getLineCount({
                    sublistId: 'inventoryassignment'
                });

            // Reject unexpected existing assignments.
            // Do not silently overwrite them.
            if (existingCount > 0) {
                throw new Error(
                    'Inventory assignments already exist. ' +
                    'Manual review required.'
                );
            }

            inventoryDetail.insertLine({
                sublistId: 'inventoryassignment',
                line: 0
            });

            inventoryDetail.setSublistValue({
                sublistId: 'inventoryassignment',
                fieldId: 'inventorystatus',
                line: 0,
                value: CONFIG.GOOD_STATUS_ID
            });

            inventoryDetail.setSublistValue({
                sublistId: 'inventoryassignment',
                fieldId: 'quantity',
                line: 0,
                value: quantity
            });


            // ----------------------------------
            // STEP 7: Verify inventory assignment
            // ----------------------------------

            const assignmentCount =
                inventoryDetail.getLineCount({
                    sublistId: 'inventoryassignment'
                });

            const assignments = [];
            let assignedQuantity = 0;

            for (let i = 0; i < assignmentCount; i++) {

                const statusId = Number(
                    inventoryDetail.getSublistValue({
                        sublistId: 'inventoryassignment',
                        fieldId: 'inventorystatus',
                        line: i
                    })
                );

                const assigned = Number(
                    inventoryDetail.getSublistValue({
                        sublistId: 'inventoryassignment',
                        fieldId: 'quantity',
                        line: i
                    })
                );

                assignedQuantity += assigned;

                assignments.push({
                    statusId,
                    quantity: assigned
                });

                if (statusId !== CONFIG.GOOD_STATUS_ID) {
                    throw new Error(
                        'Unexpected inventory status'
                    );
                }
            }

            if (assignedQuantity !== quantity) {
                throw new Error(
                    'Inventory assignment quantity mismatch'
                );
            }


            // ----------------------------------
            // STEP 8: Shipping status
            // ----------------------------------

            fulfillment.setValue({
                fieldId: 'shipstatus',
                value: 'C'
            });


            // ----------------------------------
            // STEP 9: CartonCloud dispatch memo
            // ----------------------------------

            const memo =
                'CartonCloud Dispatch: ' + dispatchId;

            fulfillment.setValue({
                fieldId: 'memo',
                value: memo
            });


            // ----------------------------------
            // STEP 10: Final verification
            // ----------------------------------

            const confirmedItemId = Number(
                fulfillment.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'item',
                    line: targetLine
                })
            );

            const confirmedLocationId = Number(
                fulfillment.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'location',
                    line: targetLine
                })
            );

            const confirmedQuantity = Number(
                fulfillment.getSublistValue({
                    sublistId: 'item',
                    fieldId: 'quantity',
                    line: targetLine
                })
            );

            const confirmedShippingStatus =
                fulfillment.getValue({
                    fieldId: 'shipstatus'
                });

            const confirmedMemo =
                fulfillment.getValue({
                    fieldId: 'memo'
                });

            if (confirmedItemId !== itemId ||
                confirmedLocationId !== locationId ||
                confirmedQuantity !== quantity ||
                confirmedShippingStatus !== 'C' ||
                confirmedMemo !== memo) {

                throw new Error(
                    'Final fulfillment validation failed'
                );
            }


            // ----------------------------------
            // STEP 11: DRY RUN RESULT
            // ----------------------------------

            // IMPORTANT:
            // There is deliberately no
            // fulfillment.save() in V3.

            const result = {

                success: true,

                test: 'FULFILLMENT_DRY_RUN',

                dryRun: CONFIG.DRY_RUN,

                salesOrderId: soId,

                itemId: confirmedItemId,

                locationId: confirmedLocationId,

                requestedQuantity: quantity,

                remainingQuantityBeforeFulfillment:
                    remainingQuantity,

                shippingStatus:
                    confirmedShippingStatus,

                memo: confirmedMemo,

                inventoryAssignments: assignments,

                duplicateCount: duplicates.length,

                fulfillmentSaved: false,

                message:
                    'All in-memory validations passed. ' +
                    'No Item Fulfillment was saved.'
            };

            log.audit({
                title: 'V3 DRY RUN PASSED',
                details: JSON.stringify(result)
            });

            return JSON.stringify(result);


        } catch (e) {

            log.error({
                title: 'V3 ERROR',
                details: JSON.stringify({
                    name: e.name,
                    message: e.message,
                    stack: e.stack
                })
            });

            return JSON.stringify({
                success: false,
                test: 'FULFILLMENT_DRY_RUN',
                fulfillmentSaved: false,
                error: {
                    name: e.name,
                    message: e.message
                }
            });
        }
    }


    // ==========================================
    // RESTLET ENTRY POINTS
    // ==========================================

    return {
        get: get,
        post: post
    };

});