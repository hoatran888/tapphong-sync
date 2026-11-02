/**
 * @NApiVersion 2.1
 * @NScriptType Restlet
 */

define([], () => {

    function post(context) {

        log.audit({
            title: 'POST Started',
            details: JSON.stringify(context)
        });

        return {
            success: true,
            script: '1948',
            message: 'POST executed successfully',
            received: context
        };
    }

    return {
        post: post
    };

});